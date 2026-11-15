//go:build linux && sqlite_integration

package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// ArchiveReserve is a shared capacity admission function. The returned
// release must be called exactly once after local temporary allocations end.
type ArchiveReserve func(context.Context, int64) (func(), error)
type ArchiveWorker struct {
	mu                      sync.Mutex
	m                       *Manager
	j                       *Journal
	remote                  archive.ActiveRetirer
	reserve                 ArchiveReserve
	stage, verify, producer string
}

const archiveSlack int64 = 4_194_304
const stageMarker = "MARKETDEPTH-ARCHIVE-SCRATCH-1\n"

var stageFile = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2}\.snapshot\.[A-Za-z0-9_-]{1,80}\.sqlite\.gz|\.snapshot-[A-Za-z0-9_-]+\.(sqlite|gz)\.part)$`)
var verifyFile = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2}\.restore\.[A-Za-z0-9_-]{1,80}\.sqlite|\.restore-[A-Za-z0-9_-]+\.(sqlite|gz)\.part)(-wal|-shm)?$`)

func privateScratch(root, name string) (string, error) {
	p := filepath.Join(root, name)
	e := os.Mkdir(p, 0700)
	fresh := e == nil
	if e != nil && !errors.Is(e, os.ErrExist) {
		return "", e
	}
	real, e := filepath.EvalSymlinks(p)
	if e != nil || real != p {
		return "", errors.New("unsafe archive scratch directory")
	}
	st, e := os.Stat(p)
	if e != nil || !st.IsDir() || st.Mode().Perm()&0077 != 0 {
		return "", errors.New("private archive scratch required")
	}
	marker := filepath.Join(p, ".owner")
	if fresh {
		f, e := os.OpenFile(marker, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			return "", e
		}
		_, e = f.WriteString(stageMarker)
		e = errors.Join(e, f.Sync(), f.Close())
		if e != nil {
			return "", e
		}
		d, e := os.Open(p)
		if e != nil {
			return "", e
		}
		if e = errors.Join(d.Sync(), d.Close()); e != nil {
			return "", e
		}
	}
	st, e = os.Lstat(marker)
	if e != nil || !st.Mode().IsRegular() || st.Size() != int64(len(stageMarker)) {
		return "", errors.New("archive scratch owner marker missing")
	}
	b, e := os.ReadFile(marker)
	if e != nil || string(b) != stageMarker {
		return "", errors.New("archive scratch owner marker mismatch")
	}
	return p, nil
}
func NewArchiveWorker(m *Manager, j *Journal, remote archive.ActiveRetirer, reserve ArchiveReserve, producer string) (*ArchiveWorker, error) {
	if m == nil || j == nil || remote == nil || reserve == nil || producer == "" || len(producer) > 128 {
		return nil, errors.New("archive dependencies required")
	}
	target, ok := j.target.(managerJournalTarget)
	if !ok || target.m != m {
		return nil, errors.New("archive journal/manager mismatch")
	}
	stage, e := privateScratch(m.root, "archive-staging")
	if e != nil {
		return nil, e
	}
	verify, e := privateScratch(m.root, "archive-verify")
	if e != nil {
		return nil, e
	}
	return &ArchiveWorker{m: m, j: j, remote: remote, reserve: reserve, stage: stage, verify: verify, producer: producer}, nil
}

// cleanJob removes only validated, worker-owned disposable snapshot/restore
// files. It never follows symlinks, walks outside scratch, or removes daily DBs.
func cleanJob(parent, dir string, pattern *regexp.Regexp) error {
	if filepath.Dir(dir) != parent {
		return errors.New("archive scratch job outside directory")
	}
	real, e := filepath.EvalSymlinks(dir)
	if e != nil || real != dir {
		return errors.New("unsafe scratch job")
	}
	st, e := os.Lstat(dir)
	if e != nil || !st.IsDir() || st.Mode().Perm()&0077 != 0 {
		return errors.New("invalid scratch job")
	}
	es, e := os.ReadDir(dir)
	if e != nil {
		return e
	}
	for _, x := range es {
		p := filepath.Join(dir, x.Name())
		st, e := os.Lstat(p)
		if e != nil || !st.Mode().IsRegular() || !pattern.MatchString(x.Name()) {
			return errors.New("unexpected scratch content; manual review required")
		}
	}
	for _, x := range es {
		if e = os.Remove(filepath.Join(dir, x.Name())); e != nil {
			return e
		}
	}
	return os.Remove(dir)
}
func cleanScratch(parent string, pattern *regexp.Regexp, prefixes ...string) error {
	es, e := os.ReadDir(parent)
	if e != nil {
		return e
	}
	for _, x := range es {
		if x.Name() == ".owner" {
			continue
		}
		ok := false
		for _, p := range prefixes {
			if strings.HasPrefix(x.Name(), p) {
				ok = true
			}
		}
		if !ok || !x.IsDir() {
			return errors.New("unknown scratch entry; manual review required")
		}
		if e = cleanJob(parent, filepath.Join(parent, x.Name()), pattern); e != nil {
			return e
		}
	}
	return nil
}
func (m *Manager) archiveDays() (out []string, e error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, errors.New("manager closed")
	}
	es, e := os.ReadDir(m.root)
	if e != nil {
		return nil, e
	}
	for _, x := range es {
		if !strings.HasSuffix(x.Name(), ".sqlite") {
			continue
		}
		d := strings.TrimSuffix(x.Name(), ".sqlite")
		if a, e := time.Parse("2006-01-02", d); e != nil || a.Format("2006-01-02") != d {
			continue
		}
		if _, e = m.path(d); e != nil {
			return nil, e
		}
		out = append(out, d)
	}
	sort.Strings(out)
	return out, nil
}
func (m *Manager) snapshotReserve(day string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, e := m.path(day)
	if e != nil {
		return 0, e
	}
	st, e := os.Stat(p)
	if e != nil {
		return 0, e
	}
	n := st.Size()
	if w, e := os.Stat(p + "-wal"); e == nil {
		n += w.Size()
	} else if !errors.Is(e, os.ErrNotExist) {
		return 0, e
	}
	if n < 0 || n > (archive.HardLimit-archiveSlack)/3 {
		return 0, errors.New("snapshot too large")
	}
	return 3*n + archiveSlack, nil
}
func restoreReserve(m archive.Manifest) (int64, error) {
	if m.Size <= 0 || m.RawSize <= 0 || m.Size > archive.HardLimit-archiveSlack || m.RawSize > archive.HardLimit-archiveSlack-m.Size {
		return 0, errors.New("invalid restore reserve")
	}
	return m.Size + m.RawSize + archiveSlack, nil
}
func (w *ArchiveWorker) stageOne(ctx context.Context, day, generation string, active bool) (string, error) {
	n, e := w.m.snapshotReserve(day)
	if e != nil {
		return "", e
	}
	release, e := w.reserve(ctx, n)
	if e != nil {
		return "", e
	}
	defer release()
	if !active {
		seal, e := w.j.SealDay(ctx, day, w.producer)
		if e != nil {
			return "", e
		}
		generation = fmt.Sprintf("r%d", seal.Revision)
	}
	dir, e := os.MkdirTemp(w.stage, "job-")
	if e != nil {
		return "", e
	}
	snap, e := w.m.CreateSnapshot(ctx, day, dir, generation, w.producer, n)
	if e != nil {
		return "", e
	}
	if active != (snap.Manifest.SealedAt == nil) {
		return "", errors.New("snapshot day state changed")
	}
	// Durable exact local bytes before releasing reservation or any remote write.
	if e = w.j.checkArchiveIntent(ctx, PendingArchive{Snapshot: snap, Active: active}, true); e != nil {
		return "", e
	}
	return "staged", nil
}
func (w *ArchiveWorker) publishPending(ctx context.Context, p PendingArchive) (string, error) {
	m := p.Snapshot.Manifest
	dir := filepath.Dir(p.Snapshot.Path)
	if filepath.Dir(dir) != w.stage || !strings.HasPrefix(filepath.Base(dir), "job-") || filepath.Base(p.Snapshot.Path) != m.Day+".snapshot."+m.Generation+".sqlite.gz" || !stageFile.MatchString(filepath.Base(p.Snapshot.Path)) {
		return "", errors.New("pending archive outside owned stage")
	}
	n, e := restoreReserve(m)
	if e != nil { return "", e }
	if p.Active {
		// Dense active recovery evidence (JSON ~2.04MB) and catalog WAL
		// need separate headroom from the restored data itself.
		if n > archive.HardLimit-8_388_608 { return "", errors.New("active evidence reservation too large") }
		n += 8_388_608
	}
	release, e := w.reserve(ctx, n)
	if e != nil {
		return "", e
	}
	defer release()
	if p.Active {
		_, e = w.j.PublishActiveSnapshot(ctx, w.remote, p.Snapshot, w.verify, n)
	} else {
		_, e = w.j.PublishSealedSnapshot(ctx, w.remote, p.Snapshot, w.verify, n)
	}
	if e != nil {
		return "", e
	}
	if e = cleanJob(w.stage, dir, stageFile); e != nil {
		return "", e
	}
	if p.Active {
		return "hourly_verified", nil
	}
	return "daily_verified", nil
}
func (w *ArchiveWorker) retire(ctx context.Context, day string, m archive.Manifest, sealed bool) (string, error) {
 mode,e:=w.j.ArchivePreservationDay(ctx);if e!=nil{return "",e}
 if mode!=""&&(sealed||mode!=day){return "",ErrArchivePreservation}
	n, e := restoreReserve(m)
	if e != nil {
		return "", e
	}
	if mode!=""{
 s,e:=w.j.ActiveState(ctx,day);if e!=nil{return "",e}
 if s.Previous==nil{return "",ErrArchivePreservation}
 prior,e:=restoreReserve(s.Previous.Manifest);if e!=nil{return "",e}
 if prior>n{n=prior}
 }
 release, e := w.reserve(ctx, n)
	if e != nil {
		return "", e
	}
	defer release()
	if mode!=""{
 if e=w.j.PreservePreviousActive(ctx,w.remote,day,w.verify,n);e!=nil{return "",e}
 return "active_preserved",nil
 }
 if sealed {
		e = w.j.RetireSealedActive(ctx, w.remote, day, w.verify, n)
	} else {
		e = w.j.RetirePreviousActive(ctx, w.remote, day, w.verify, n)
	}
	if e != nil {
		return "", e
	}
	return "active_retired", nil
}

// Cycle does at most one bounded operation; upload failures retain the exact
// pending bytes. Caller supplies a retry/backoff loop. Local collection may
// continue independently; no daily eviction or remote permanent delete here.
func (w *ArchiveWorker) Cycle(ctx context.Context) (string, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if e := ctx.Err(); e != nil {
		return "", e
	}
	now := w.m.now()
	today := model.Day(now.UnixMilli())
 mode,e:=w.j.ArchivePreservationDay(ctx);if e!=nil{return "",e}
 if mode!=""{
 if today!=mode{return "",ErrArchivePreservation}
 days,e:=w.m.archiveDays();if e!=nil{return "",e}
 for _,d:=range days{if d!=mode{return "",ErrArchivePreservation}}
 }
	p, e := w.j.ArchivePending(ctx)
	if e != nil {
		return "", e
	}
	if e = cleanScratch(w.verify, verifyFile, ".verify-", ".retire-verify-", ".sealed-retire-verify-"); e != nil {
		return "", e
	}
	if p != nil {
 if mode!=""&&(!p.Active||p.Snapshot.Manifest.Day!=mode){return "",ErrArchivePreservation}
		return w.publishPending(ctx, *p)
	}
	if e = cleanScratch(w.stage, stageFile, "job-"); e != nil {
		return "", e
	}
	days, e := w.m.archiveDays()
	if e != nil {
		return "", e
	}
	for _, day := range days {
		a, _, e := dayRange(day, day)
		if e != nil {
			return "", e
		}
		if now.Before(a.Add(24*time.Hour + w.m.grace)) {
			continue
		}
		rec, e := w.j.ArchiveRecord(ctx, day, 0)
		if errors.Is(e, sql.ErrNoRows) {
			return w.stageOne(ctx, day, "", false)
		}
		if e != nil {
			return "", e
		}
		if _, e = w.j.ActiveState(ctx, day); e == nil {
			return w.retire(ctx, day, rec.Manifest, true)
		} else if !errors.Is(e, sql.ErrNoRows) {
			return "", e
		}
	}
	if len(days) == 0 || days[len(days)-1] != today {
		return "idle", nil
	}
	s, e := w.j.ActiveState(ctx, today)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return "", e
	}
	if s.Previous != nil {
		return w.retire(ctx, today, s.Current.Manifest, false)
	}
	slot := now.Truncate(time.Hour)
	if now.Before(slot.Add(time.Minute)) {
		return "idle", nil
	}
	gen := archive.HourGeneration(slot)
	if s.Current.Manifest.Generation >= gen {
		return "idle", nil
	}
	return w.stageOne(ctx, today, gen, true)
}

// ClearDisposableScratch reclaims only recognized scratch directories not
// owned by a durable pending upload. Never waits behind a network operation.
func(w *ArchiveWorker) ClearDisposableScratch(ctx context.Context)(string,error){
 if !w.mu.TryLock(){return "maintenance_busy",nil}
 defer w.mu.Unlock()
 if e:=ctx.Err();e!=nil{return "",e}
 p,e:=w.j.ArchivePending(ctx);if e!=nil{return "",e}
 if e=cleanScratch(w.verify,verifyFile,".verify-",".retire-verify-",".sealed-retire-verify-");e!=nil{return "",e}
 if p==nil{
  if e=cleanScratch(w.stage,stageFile,"job-");e!=nil{return "",e}
 }else{
  protected:=filepath.Dir(p.Snapshot.Path)
  if filepath.Dir(protected)!=w.stage||!strings.HasPrefix(filepath.Base(protected),"job-"){return "",ErrArchivePending}
  es,e:=os.ReadDir(w.stage);if e!=nil{return "",e}
  for _,x:=range es{
   if x.Name()==".owner"{continue}
   path:=filepath.Join(w.stage,x.Name())
   if path==protected{continue}
   if !x.IsDir()||!strings.HasPrefix(x.Name(),"job-"){return "",errors.New("unknown scratch entry; manual review required")}
   if e=cleanJob(w.stage,path,stageFile);e!=nil{return "",e}
  }
 }
 return "scratch_checked",nil
}

// IdleMaintenance serializes network-backed archive maintenance with Cycle and pressure work.
func(w *ArchiveWorker) IdleMaintenance(ctx context.Context,r *ArchiveReader)(string,error){
 if !w.mu.TryLock(){return "maintenance_busy",nil}
 defer w.mu.Unlock()
 steps:=[]func(context.Context)(string,error){r.ReclaimVerifiedCycle,r.CompactVerifiedCycle,r.SyncLossCycle}
 if free,e:=r.CatalogFreePages(ctx);e!=nil{
  return "",e
 }else if free>=64{
  steps=append(steps,r.VacuumCatalogCycle)
 }
 for _,f:=range steps{
  state,e:=f(ctx);if e!=nil||state!="idle"{return state,e}
 }
 return "idle",nil
}
// PressureVerified tries one verified reclaim without waiting behind a publish.
func(w *ArchiveWorker) PressureVerified(ctx context.Context,r *ArchiveReader)(string,error){
 if !w.mu.TryLock(){return "maintenance_busy",nil}
 defer w.mu.Unlock()
 return r.ReclaimVerifiedCycle(ctx)
}
