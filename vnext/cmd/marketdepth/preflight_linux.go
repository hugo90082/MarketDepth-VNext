//go:build linux && live_ws && sqlite_integration && secure_auth

package main

import (
	"encoding/json"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/runtimeapp"
	"os"
)

func checkProduction(root, addr, origin, credentials, producer, leaseDir string, roots []string) error {
	p, e := runtimeapp.CheckProduction(runtimeapp.ProductionConfig{Root: root, Listen: addr, Origin: origin, Credentials: credentials, Producer: producer, LeaseDir: leaseDir, ProtectedRoots: roots}, os.Getenv("MD_SESSION_KEY_B64"), os.Getenv("MD_PASSWORD_BCRYPT"))
	if e != nil {
		return e
	}
	return json.NewEncoder(os.Stdout).Encode(p)
}
