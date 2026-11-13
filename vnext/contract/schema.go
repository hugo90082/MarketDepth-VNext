// Package contract embeds the unchanged public MD-VNEXT-1 schema.
package contract

import _ "embed"

//go:embed schema.sql
var Schema string
