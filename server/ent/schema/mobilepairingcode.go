package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// MobilePairingCode is a one-time, short-lived code that lets a phone obtain a
// mobile identity for a specific user. Only the SHA-256 hash is stored.
type MobilePairingCode struct {
	ent.Schema
}

func (MobilePairingCode) Fields() []ent.Field {
	return []ent.Field{
		field.String("code_hash").
			Unique().
			NotEmpty().
			Immutable().
			Comment("SHA-256 hex of the plaintext pairing code"),
		field.String("user_id").
			NotEmpty().
			Comment("User the paired phone will belong to"),
		field.Time("created_at").
			Immutable().
			Default(time.Now),
		field.Time("expires_at"),
		field.Time("used_at").
			Optional().
			Nillable(),
		field.String("mobile_device_id").
			Optional().
			Comment("Mobile device that consumed the code"),
	}
}

func (MobilePairingCode) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_id"),
		index.Fields("expires_at"),
	}
}
