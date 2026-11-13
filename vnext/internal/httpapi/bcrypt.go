//go:build secure_auth

package httpapi

import (
	"errors"
	"golang.org/x/crypto/bcrypt"
)

// NewBcryptAuth refuses weak hashes or excessively expensive parameters.
// Passwords are never persisted in clear text. Cost 12 is the default target,
// subject to actual 512MB CPU testing. Hash and key are independent secrets.
func NewBcryptAuth(origin string, key, hash []byte) (*Auth, error) {
	cost, e := bcrypt.Cost(hash)
	if e != nil || cost < 10 || cost > 14 {
		return nil, errors.New("bcrypt cost must be 10..14")
	}
	h := append([]byte(nil), hash...)
	return newAuth(origin, key, func(password []byte) bool { return bcrypt.CompareHashAndPassword(h, password) == nil })
}
