package store

import (
	"context"
	"errors"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"testing"
	"time"
)

type queueWriter struct {
	entered chan model.Row
	release chan struct{}
}

func (w queueWriter) Put(ctx context.Context, rows []model.Row) error {
	w.entered <- rows[0]
	select {
	case <-w.release:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func TestWriteQueueBoundAckAndClose(t *testing.T) {
	w := queueWriter{make(chan model.Row, 4), make(chan struct{}, 4)}
	q, e := NewWriteQueue(w, 1)
	if e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	r := liveRows()[0]
	done := make(chan error, 2)
	go func() { done <- q.Put(ctx, []model.Row{r}) }()
	select {
	case <-w.entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	go func() { done <- q.Put(ctx, []model.Row{r}) }()
	deadline := time.Now().Add(time.Second)
	for len(q.requests) != 1 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if len(q.requests) != 1 {
		t.Fatal("second request did not queue")
	}
	if e = q.Put(ctx, []model.Row{r}); !errors.Is(e, ErrQueueFull) {
		t.Fatal(e)
	}
	select {
	case <-done:
		t.Fatal("ack before commit")
	default:
	}
	w.release <- struct{}{}
	if e = <-done; e != nil {
		t.Fatal(e)
	}
	select {
	case <-w.entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	w.release <- struct{}{}
	if e = <-done; e != nil {
		t.Fatal(e)
	}
	if e = q.Close(ctx); e != nil {
		t.Fatal(e)
	}
	if e = q.Put(ctx, []model.Row{r}); !errors.Is(e, ErrQueueClosed) {
		t.Fatal(e)
	}
}
