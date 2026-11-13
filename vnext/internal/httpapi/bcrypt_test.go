//go:build secure_auth

package httpapi

import (
	"bytes"
	"golang.org/x/crypto/bcrypt"
	"testing"
)

func TestBcryptVerifier(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	h, e := bcrypt.GenerateFromPassword([]byte("test-only-password"), 10)
	if e != nil {
		t.Fatal(e)
	}
	a, e := NewBcryptAuth("https://depth.example", key, h)
	if e != nil || !a.verify([]byte("test-only-password")) || a.verify([]byte("wrong")) {
		t.Fatal(e)
	}
	weak, _ := bcrypt.GenerateFromPassword([]byte("test-only-password"), 4)
	if _, e = NewBcryptAuth("https://depth.example", key, weak); e == nil {
		t.Fatal("weak bcrypt accepted")
	}
}
