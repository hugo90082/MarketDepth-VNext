//go:build !linux || !live_ws || !sqlite_integration || !secure_auth

package main

import (
	"context"
	"errors"
)

func checkProduction(root, addr, origin, credentials, producer, leaseDir string, roots []string) error {
	return errors.New("production preflight requires Linux and live_ws,sqlite_integration,secure_auth build tags")
}

func runProduction(ctx context.Context, root, addr, origin, webDir string, init bool, credentials, producer, leaseDir string, allowLoss, resumeRecovered bool) error {
	return errors.New("production runtime requires Linux and live_ws,sqlite_integration,secure_auth build tags")
}

func recoverProduction(ctx context.Context, root, credentials, producer, leaseDir string) error {
	return errors.New("production recovery requires Linux and live_ws,sqlite_integration,secure_auth build tags")
}

func seedProduction(ctx context.Context, root string, initRoot bool, vnextSQLiteCSV, v66JSONL, legacySpotDir, binanceF1mDays, legacyEnv, vnextEnvOut string) error {
	return errors.New("production seed requires Linux and live_ws,sqlite_integration,secure_auth build tags")
}
