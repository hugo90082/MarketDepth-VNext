// One-time local OAuth bootstrap. Never run this on a public listener.
package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive/drive"
)

func secret() (string, error) {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		return "", e
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
func run() error {
	config := flag.String("client", "", "Google downloaded Desktop JSON")
	output := flag.String("out", "", "new private .oauth.json file (must not exist)")
	flag.Parse()
	if *config == "" || *output == "" {
		return errors.New("use --client PATH --out PATH; keep both files private")
	}
	if _, e := os.Lstat(*output); !os.IsNotExist(e) {
		return errors.New("output already exists or cannot be checked")
	}
	f, e := os.Open(*config)
	if e != nil {
		return errors.New("cannot read Desktop JSON")
	}
	c, e := drive.ReadDesktopConfig(f)
	f.Close()
	if e != nil {
		return e
	}
	state, e := secret()
	if e != nil {
		return e
	}
	verifier, e := secret()
	if e != nil {
		return e
	}
	digest := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(digest[:])
	ln, e := net.Listen("tcp4", "127.0.0.1:0")
	if e != nil {
		return errors.New("cannot listen on local callback")
	}
	defer ln.Close()
	redirect := "http://" + ln.Addr().String() + "/callback"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	codes := make(chan string, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if r.Method != "GET" || r.Host != ln.Addr().String() || subtle.ConstantTimeCompare([]byte(r.URL.Query().Get("state")), []byte(state)) != 1 {
			http.Error(w, "Invalid callback", 400)
			return
		}
		code := r.URL.Query().Get("code")
		if code == "" || r.URL.Query().Get("error") != "" {
			http.Error(w, "Authorization not completed", 400)
			return
		}
		select {
		case codes <- code:
			fmt.Fprintln(w, "Authorization received. Return to the local terminal; it will confirm completion.")
		default:
			http.Error(w, "Callback already received", 409)
		}
	})
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, MaxHeaderBytes: 8192}
	defer srv.Close()
	go srv.Serve(ln)
	fmt.Println("Open this Google authorization URL in your own browser (do not share it):")
	fmt.Println(drive.AuthorizationURL(c, redirect, state, challenge))
	var code string
	select {
	case code = <-codes:
	case <-ctx.Done():
		return errors.New("authorization timed out")
	}
	cred, e := drive.ExchangeCode(ctx, c, redirect, code, verifier)
	if e != nil {
		return e
	}
	if e = drive.WriteCredentials(*output, cred); e != nil {
		return e
	}
	fmt.Println("Authorization saved to your private file. Do not upload it to chat or GitHub.")
	return nil
}
func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
