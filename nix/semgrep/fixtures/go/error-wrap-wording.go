package fixture

import "fmt"

func bad(err error) {
	// ruleid: go-error-wrap-wording
	_ = fmt.Errorf("Failed opening file: %w", err)
	// ruleid: go-error-wrap-wording
	_ = fmt.Errorf("Unable to read file: %w", err)
	// ruleid: go-error-wrap-wording
	_ = fmt.Errorf("Could not load file: %w", err)
	// ruleid: go-error-wrap-wording
	_ = fmt.Errorf("Error reading file: %w", err)
	// ruleid: go-error-wrap-wording
	_ = fmt.Errorf("Cannot load file: %w", err)
	// ruleid: go-error-wrap-wording
	_ = fmt.Errorf("Can not open file: %w", err)
	// ruleid: go-error-wrap-wording
	_ = fmt.Errorf("fail to open file: %w", err)
}

func good(err error) {
	// ok: go-error-wrap-wording
	_ = fmt.Errorf("opening file: %w", err)
	// ok: go-error-wrap-wording
	_ = fmt.Errorf("operation failed: %w", err)
	// ok: go-error-wrap-wording
	_ = fmt.Errorf("failure to open file: %w", err)
	// ok: go-error-wrap-wording
	_ = fmt.Errorf("failing to open file: %w", err)
	// ok: go-error-wrap-wording
	_ = fmt.Errorf("%s: %w", "failed to open file", err)
	// ok: go-error-wrap-wording
	_ = fmt.Sprintf("Failed opening file: %s", "x")
	// ok: go-error-wrap-wording
	// fmt.Errorf("Failed opening file")
}
