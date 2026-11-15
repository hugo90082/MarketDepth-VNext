// Package runtimeprofile fixes runtime identities. No arbitrary namespace string
// is accepted by the release entry point. A profile is not an approval to write.
package runtimeprofile

type Profile uint8

const (
	Staging Profile = iota + 1
	Production
)

func (p Profile) Valid() bool { return p == Staging || p == Production }
func (p Profile) Namespace() string {
	switch p {
	case Staging:
		return "MarketDepth-VNext-staging"
	case Production:
		return "MarketDepth-VNext"
	}
	return ""
}
func (p Profile) Marker() (string, string) {
	switch p {
	case Staging:
		return ".marketdepth-vnext-staging", "MARKETDEPTH-VNEXT-STAGING-1\n"
	case Production:
		return ".marketdepth-vnext-production", "MARKETDEPTH-VNEXT-PRODUCTION-1\n"
	}
	return "", ""
}
func (p Profile) Mode() string {
	switch p {
	case Staging:
		return "isolated_staging"
	case Production:
		return "production"
	}
	return "invalid"
}
