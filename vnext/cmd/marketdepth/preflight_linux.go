//go:build linux && live_ws && sqlite_integration && secure_auth

package main

import (
	"context"
	"encoding/json"
	"os"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/runtimeapp"
)

func checkProduction(root, addr, origin, credentials, producer, leaseDir string, roots []string) error {
	p, e := runtimeapp.CheckProduction(runtimeapp.ProductionConfig{Root: root, Listen: addr, Origin: origin, Credentials: credentials, Producer: producer, LeaseDir: leaseDir, ProtectedRoots: roots}, os.Getenv("MD_SESSION_KEY_B64"), os.Getenv("MD_PASSWORD_BCRYPT"))
	if e != nil {
		return e
	}
	return json.NewEncoder(os.Stdout).Encode(p)
}

func runProduction(ctx context.Context, root, addr, origin, webDir string, init bool, credentials, producer, leaseDir string, allowLoss, resumeRecovered bool) error {
	return runtimeapp.RunProduction(ctx, root, addr, origin, webDir, init, credentials, producer, leaseDir, allowLoss, resumeRecovered)
}

func recoverProduction(ctx context.Context, root, credentials, producer, leaseDir string) error {
	return runtimeapp.RecoverProduction(ctx, root, credentials, producer, leaseDir)
}
