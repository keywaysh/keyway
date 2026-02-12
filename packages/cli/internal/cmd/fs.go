package cmd

import (
	"os"
)

// osReadFile wraps os.ReadFile
var osReadFile = os.ReadFile

// osWriteFile wraps os.WriteFile with proper permissions
var osWriteFile = func(name string, data []byte, perm uint32) error {
	return os.WriteFile(name, data, os.FileMode(perm))
}
