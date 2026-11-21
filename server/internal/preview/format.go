// Package preview contains the isolated Office-to-PDF conversion Worker and
// the authenticated HTTP client used by the main Server.
package preview

import (
	"path/filepath"
	"strings"
)

// ConverterVersion is part of every derived preview cache key. Bump it when
// the conversion contract changes in a way that requires regenerating PDFs.
const ConverterVersion = "libreoffice-pdf-v1"

// ExtensionHeader carries only an allowlisted extension, never a display name
// or desktop filesystem path.
const ExtensionHeader = "X-DSH-Preview-Extension"

var officeExtensions = map[string]bool{
	"doc":  true,
	"docx": true,
	"ppt":  true,
	"pptx": true,
	"xls":  true,
	"xlsx": true,
}

var officeMIMES = map[string]string{
	"application/msword": "doc",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":   "docx",
	"application/vnd.ms-powerpoint":                                             "ppt",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
	"application/vnd.ms-excel":                                                  "xls",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         "xlsx",
}

// OfficeExtension returns the fixed conversion extension for a display name.
// An explicit Office MIME also covers attachment names with no extension. The
// Worker receives only this allowlisted value, never the display name itself.
func OfficeExtension(name, mime string) (string, bool) {
	extension := strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), ".")
	if officeExtensions[extension] {
		return extension, true
	}
	if filepath.Ext(name) != "" {
		return "", false
	}
	extension, ok := officeMIMES[normalizeMIME(mime)]
	return extension, ok
}

// SupportedOfficeExtension is the Worker's complete input extension allowlist.
func SupportedOfficeExtension(extension string) bool {
	return officeExtensions[extension]
}

// IsPDF recognizes PDF attachments without consulting a desktop path.
func IsPDF(name, mime string) bool {
	return strings.EqualFold(filepath.Ext(name), ".pdf") || normalizeMIME(mime) == "application/pdf"
}

func normalizeMIME(value string) string {
	return strings.ToLower(strings.TrimSpace(strings.Split(value, ";")[0]))
}
