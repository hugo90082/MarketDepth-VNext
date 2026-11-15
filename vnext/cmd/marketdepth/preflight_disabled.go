//go:build !linux || !live_ws || !sqlite_integration || !secure_auth

package main

import "errors"

func checkProduction(root, addr, origin, credentials, producer, leaseDir string, roots []string) error {
	return errors.New("production preflight requires Linux and live_ws,sqlite_integration,secure_auth build tags")
}
