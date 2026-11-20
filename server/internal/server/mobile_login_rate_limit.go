package server

import (
	"sync"
	"time"
)

const (
	mobileLoginFailureWindow = time.Minute
	mobileLoginBlockDuration = 5 * time.Minute
	mobileLoginMaxFailures   = 5
	mobileLoginMaxEntries    = 4096
)

type mobileLoginAttempt struct {
	failures     int
	windowStart  time.Time
	blockedUntil time.Time
	lastSeen     time.Time
}

// mobileLoginRateLimiter is a bounded, per-process guard against password
// guessing. A deployment with multiple Server replicas should also enforce
// equivalent limits at its shared ingress.
type mobileLoginRateLimiter struct {
	mu      sync.Mutex
	entries map[string]mobileLoginAttempt
}

func newMobileLoginRateLimiter() *mobileLoginRateLimiter {
	return &mobileLoginRateLimiter{entries: make(map[string]mobileLoginAttempt)}
}

func (l *mobileLoginRateLimiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.cleanupLocked(now)
	entry, exists := l.entries[key]
	return !exists || entry.blockedUntil.IsZero() || !now.Before(entry.blockedUntil)
}

func (l *mobileLoginRateLimiter) failure(key string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.cleanupLocked(now)
	entry := l.entries[key]
	if entry.windowStart.IsZero() || now.Sub(entry.windowStart) >= mobileLoginFailureWindow || (!entry.blockedUntil.IsZero() && !now.Before(entry.blockedUntil)) {
		entry = mobileLoginAttempt{windowStart: now}
	}
	entry.failures++
	entry.lastSeen = now
	if entry.failures >= mobileLoginMaxFailures {
		entry.blockedUntil = now.Add(mobileLoginBlockDuration)
	}
	l.entries[key] = entry
}

func (l *mobileLoginRateLimiter) success(key string) {
	l.mu.Lock()
	delete(l.entries, key)
	l.mu.Unlock()
}

func (l *mobileLoginRateLimiter) cleanupLocked(now time.Time) {
	if len(l.entries) < mobileLoginMaxEntries {
		return
	}
	for key, entry := range l.entries {
		if now.Sub(entry.lastSeen) > mobileLoginBlockDuration+mobileLoginFailureWindow {
			delete(l.entries, key)
		}
	}
	for len(l.entries) >= mobileLoginMaxEntries {
		var oldestKey string
		var oldest time.Time
		for key, entry := range l.entries {
			if oldestKey == "" || entry.lastSeen.Before(oldest) {
				oldestKey, oldest = key, entry.lastSeen
			}
		}
		if oldestKey == "" {
			return
		}
		delete(l.entries, oldestKey)
	}
}
