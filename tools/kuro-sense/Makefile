VERSION ?= 0.1.0
BINARY = kuro-sense
LDFLAGS = -ldflags "-s -w -X github.com/miles990/mini-agent/tools/kuro-sense/cmd.Version=$(VERSION)"

.PHONY: build build-all clean test

build:
	go build $(LDFLAGS) -o $(BINARY) .

build-all:
	GOOS=darwin  GOARCH=arm64 go build $(LDFLAGS) -o dist/$(BINARY)-darwin-arm64 .
	GOOS=darwin  GOARCH=amd64 go build $(LDFLAGS) -o dist/$(BINARY)-darwin-amd64 .
	GOOS=linux   GOARCH=amd64 go build $(LDFLAGS) -o dist/$(BINARY)-linux-amd64 .
	GOOS=linux   GOARCH=arm64 go build $(LDFLAGS) -o dist/$(BINARY)-linux-arm64 .

clean:
	rm -f $(BINARY)
	rm -rf dist/

test:
	go test ./...
