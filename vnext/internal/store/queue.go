package store

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"sync"
)

var ErrQueueFull = errors.New("writer queue full; explicit retry required")
var ErrQueueClosed = errors.New("writer queue closed")

type writeRequest struct {
	ctx  context.Context
	rows []model.Row
	ack  chan error
}

// WriteQueue is a bounded, single-consumer admission layer. A successful Put
// means the underlying writer has committed. Rejected requests are explicit;
// no drop-oldest policy. Cancellation after admission may race a commit: the
// caller must reconcile or retry the identical batch, never fabricate a row.
// Close drains admitted requests; the caller still owns the underlying writer.
type WriteQueue struct {
	mu       sync.RWMutex
	closed   bool
	requests chan writeRequest
	done     chan struct{}
}

func NewWriteQueue(w Writer, capacity int) (*WriteQueue, error) {
	if w == nil || capacity < 1 || capacity > 64 {
		return nil, errors.New("writer queue capacity must be 1..64")
	}
	q := &WriteQueue{requests: make(chan writeRequest, capacity), done: make(chan struct{})}
	go func() {
		defer close(q.done)
		for r := range q.requests {
			if e := r.ctx.Err(); e != nil {
				r.ack <- e
			} else {
				r.ack <- w.Put(r.ctx, r.rows)
			}
		}
	}()
	return q, nil
}
func (q *WriteQueue) Put(ctx context.Context, rows []model.Row) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	if len(rows) > 1000 {
		return errors.New("batch exceeds 1000 rows")
	}
	// Copy typed rows to isolate ownership of pointer fields from the producer.
	owned := make([]model.Row, 0, len(rows))
	for _, r := range rows {
		if rowNil(r) {
			return errors.New("nil row")
		}
		if e := r.Validate(); e != nil {
			return e
		}
		b, e := json.Marshal(r)
		if e != nil {
			return e
		}
		v, e := model.Decode(r.Kind(), b)
		if e != nil {
			return e
		}
		owned = append(owned, v)
	}
	req := writeRequest{ctx: ctx, rows: owned, ack: make(chan error, 1)}
	q.mu.RLock()
	if q.closed {
		q.mu.RUnlock()
		return ErrQueueClosed
	}
	select {
	case q.requests <- req:
		q.mu.RUnlock()
	default:
		q.mu.RUnlock()
		return ErrQueueFull
	}
	select {
	case e := <-req.ack:
		return e
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (q *WriteQueue) Close(ctx context.Context) error {
	q.mu.Lock()
	if !q.closed {
		q.closed = true
		close(q.requests)
	}
	q.mu.Unlock()
	select {
	case <-q.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
