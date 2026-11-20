package server

import (
	"testing"
	"time"
)

func TestMobileLoginRateLimiterBlocksRepeatedFailuresAndSuccessResets(t *testing.T) {
	limiter := newMobileLoginRateLimiter()
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	key := "192.0.2.10\x00owner@example.com"
	for attempt := 1; attempt <= mobileLoginMaxFailures; attempt++ {
		if !limiter.allow(key, now) {
			t.Fatalf("attempt %d was blocked before reaching the failure threshold", attempt)
		}
		limiter.failure(key, now)
	}
	if limiter.allow(key, now.Add(time.Second)) {
		t.Fatal("repeated failures did not block the login key")
	}
	limiter.success(key)
	if !limiter.allow(key, now.Add(2*time.Second)) {
		t.Fatal("successful login did not clear the failure state")
	}
}

func TestMobileLoginRateLimiterBlockExpires(t *testing.T) {
	limiter := newMobileLoginRateLimiter()
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	key := "192.0.2.10\x00owner@example.com"
	for range mobileLoginMaxFailures {
		limiter.failure(key, now)
	}
	if limiter.allow(key, now.Add(mobileLoginBlockDuration-time.Millisecond)) {
		t.Fatal("login block expired too early")
	}
	if !limiter.allow(key, now.Add(mobileLoginBlockDuration+time.Millisecond)) {
		t.Fatal("login block did not expire")
	}
	limiter.failure(key, now.Add(mobileLoginBlockDuration+time.Millisecond))
	if !limiter.allow(key, now.Add(mobileLoginBlockDuration+2*time.Millisecond)) {
		t.Fatal("first failure after an expired block was treated as a repeated failure")
	}
}
