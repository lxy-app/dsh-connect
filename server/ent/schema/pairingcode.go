package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// PairingCode is a one-time desktop pairing code. Only the SHA-256 hash is
// stored; the plaintext code is returned to the Admin exactly once.
type PairingCode struct {
	ent.Schema
}

func (PairingCode) Fields() []ent.Field {
	return []ent.Field{
		field.String("code_hash").
			Unique().
			NotEmpty().
			Immutable().
			Comment("SHA-256 hex of the plaintext pairing code"),
		field.Time("created_at").
			Immutable().
			Default(time.Now),
		field.Time("expires_at"),
		field.Time("used_at").
			Optional().
			Nillable().
			Comment("Set when a Connector consumes the code"),
		field.String("device_id").
			Optional().
			Comment("Device that consumed the code"),
	}
}

func (PairingCode) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("expires_at"),
	}
}
