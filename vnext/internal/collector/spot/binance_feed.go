package spot

import (
	"errors"
	"strconv"
	"strings"
	"sync"
	"time"
)

const maxBridgeMessages = 4096
const maxBridgeLevels = 200000

// BinanceFeed serializes the cut clock with decoded observations. The receive
// timestamp is assigned at the admission lock, not at a future exchange event
// time. Raw socket receipt latency is a separate diagnostic (later QA).
type BinanceFeed struct {
	mu    sync.Mutex
	book  *BinanceBook
	asset string
	now   func() time.Time
}

func NewBinanceFeed(asset string, firstTarget int64) (*BinanceFeed, error) {
	if asset != "BTC" && asset != "ETH" {
		return nil, errors.New("persistent Binance book only BTC/ETH")
	}
	b, e := NewBinanceBook(firstTarget)
	if e != nil {
		return nil, e
	}
	return &BinanceFeed{book: b, asset: asset, now: time.Now}, nil
}
func (f *BinanceFeed) Cut(t int64) (BinanceCut, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.book.Cut(t, f.now().UnixMilli())
}
func (f *BinanceFeed) StreamURL() string {
	return "wss://stream.binance.com:9443/ws/" + strings.ToLower(Symbol("binance", f.asset)) + "@depth"
}
func (f *BinanceFeed) refreshReason() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.book.RefreshReason(f.now().UnixMilli())
}

type binanceSession struct {
	f                        *BinanceFeed
	live, collecting, failed bool
	buf                      []BinanceDelta
	levels                   int
}

func (f *BinanceFeed) newSession() *binanceSession { return &binanceSession{f: f, collecting: true} }
func (s *binanceSession) failLocked(reason string) {
	s.failed = true
	s.live = false
	s.collecting = false
	s.buf = nil
	s.levels = 0
	_ = s.f.book.Invalidate(s.f.now().UnixMilli(), reason)
}
func (s *binanceSession) fail(reason string) {
	s.f.mu.Lock()
	defer s.f.mu.Unlock()
	if !s.failed {
		s.failLocked(reason)
	}
}
func (s *binanceSession) beginRefresh() error {
	s.f.mu.Lock()
	defer s.f.mu.Unlock()
	if s.failed || !s.live || s.collecting {
		return errors.New("cannot start refresh")
	}
	s.collecting = true
	s.buf = nil
	s.levels = 0
	return nil
}
func (s *binanceSession) onDelta(d BinanceDelta) error {
	s.f.mu.Lock()
	defer s.f.mu.Unlock()
	if s.failed {
		return errors.New("session failed")
	}
	if e := validDelta(d); e != nil {
		s.failLocked("invalid_delta")
		return e
	}
	if s.collecting {
		n := len(d.Bids) + len(d.Asks)
		if len(s.buf) >= maxBridgeMessages || s.levels+n > maxBridgeLevels {
			s.failLocked("bridge_buffer_overflow")
			return errors.New("bridge buffer overflow")
		}
		s.buf = append(s.buf, d)
		s.levels += n
	}
	if s.live {
		if e := s.f.book.Delta(s.f.now().UnixMilli(), d); e != nil {
			s.failLocked("sequence_or_book_failure")
			return e
		}
	}
	return nil
}
func (s *binanceSession) tryInstall(snap BinanceSnapshot) error {
	s.f.mu.Lock()
	defer s.f.mu.Unlock()
	if s.failed || !s.collecting {
		return errors.New("session not collecting")
	}
	// No bridge yet is not a failure until deadline. The actual install performs
	// full snapshot validation and handles refresh outer-level zero deletions.
	if _, _, e := Bridge(snap, s.buf); e != nil {
		if errors.Is(e, ErrBridgePending) {
			return e
		}
		s.failLocked("bridge_failed")
		return e
	}
	if e := s.f.book.Install(s.f.now().UnixMilli(), snap, s.buf, s.live); e != nil {
		s.failLocked("install_failed")
		return e
	}
	s.live = true
	s.collecting = false
	s.buf = nil
	s.levels = 0
	return nil
}
func parseBinanceLevels(rows [][]string, allowZero bool) ([]Level, error) {
	ls := make([]Level, 0, len(rows))
	for _, r := range rows {
		if len(r) != 2 {
			return nil, errors.New("invalid Binance level length")
		}
		p, e := strconv.ParseFloat(r[0], 64)
		if e != nil {
			return nil, e
		}
		q, e := strconv.ParseFloat(r[1], 64)
		if e != nil {
			return nil, e
		}
		if !finite(p) || !finite(q) || p <= 0 || q < 0 || (!allowZero && q == 0) {
			return nil, errors.New("invalid Binance level")
		}
		ls = append(ls, Level{p, q})
	}
	return ls, nil
}
