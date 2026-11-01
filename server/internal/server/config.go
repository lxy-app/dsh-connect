package server

import (
	"errors"
	"time"
)

const maxCommandTimeout = 2 * time.Minute

type Config struct {
	BootstrapToken        string
	DatabaseURL           string
	ServerURL             string
	PairingCodeTTL        time.Duration
	PairingChallengeTTL   time.Duration
	MobilePairingCodeTTL  time.Duration
	MobileAccessTokenTTL  time.Duration
	MobileRefreshTokenTTL time.Duration
	CommandTimeout        time.Duration
	MaxPayloadBytes       int64
	HeartbeatInterval     time.Duration
	WriteTimeout          time.Duration
	EventBuffer           int
	AdminSessionTTL       time.Duration
	AdminOrigin           string

	BootstrapOwnerEmail    string
	BootstrapOwnerPassword string
	BootstrapOwnerName     string
}

func (c Config) withDefaults() (Config, error) {
	if c.BootstrapToken == "" {
		return Config{}, errors.New("DSH_CONNECT_BOOTSTRAP_TOKEN is required")
	}
	if c.DatabaseURL == "" {
		c.DatabaseURL = "postgres://dsh:dsh@127.0.0.1:5432/dsh_connect?sslmode=disable"
	}
	if c.ServerURL == "" {
		c.ServerURL = "http://127.0.0.1:8787"
	}
	if c.PairingCodeTTL == 0 {
		c.PairingCodeTTL = 10 * time.Minute
	}
	if c.PairingChallengeTTL == 0 {
		c.PairingChallengeTTL = 5 * time.Minute
	}
	if c.MobilePairingCodeTTL == 0 {
		c.MobilePairingCodeTTL = 5 * time.Minute
	}
	if c.MobileAccessTokenTTL == 0 {
		c.MobileAccessTokenTTL = 15 * time.Minute
	}
	if c.MobileRefreshTokenTTL == 0 {
		c.MobileRefreshTokenTTL = 30 * 24 * time.Hour
	}
	if c.CommandTimeout == 0 {
		c.CommandTimeout = 15 * time.Second
	}
	if c.MaxPayloadBytes == 0 {
		c.MaxPayloadBytes = 64 << 10
	}
	if c.HeartbeatInterval == 0 {
		c.HeartbeatInterval = 20 * time.Second
	}
	if c.WriteTimeout == 0 {
		c.WriteTimeout = 5 * time.Second
	}
	if c.EventBuffer == 0 {
		c.EventBuffer = 64
	}
	if c.AdminSessionTTL == 0 {
		c.AdminSessionTTL = 12 * time.Hour
	}
	if c.BootstrapOwnerName == "" {
		c.BootstrapOwnerName = "Owner"
	}
	if c.PairingCodeTTL < 0 || c.PairingChallengeTTL < 0 || c.CommandTimeout < 0 || c.CommandTimeout > maxCommandTimeout {
		return Config{}, errors.New("invalid timeout configuration")
	}
	if c.MobilePairingCodeTTL <= 0 || c.MobileAccessTokenTTL <= 0 || c.MobileRefreshTokenTTL <= 0 {
		return Config{}, errors.New("invalid mobile token TTL configuration")
	}
	if c.MaxPayloadBytes < 1024 || c.HeartbeatInterval <= 0 || c.WriteTimeout <= 0 || c.EventBuffer < 1 {
		return Config{}, errors.New("invalid payload, heartbeat, or buffer configuration")
	}
	if c.AdminSessionTTL <= 0 {
		return Config{}, errors.New("invalid admin session TTL")
	}
	return c, nil
}
