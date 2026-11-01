package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// MobileDevice is a paired phone. Credential material is persisted as SHA-256
// hashes only; rotating a refresh token also replaces the access token.
type MobileDevice struct {
	ent.Schema
}

func (MobileDevice) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").
			Unique().
			NotEmpty().
			Immutable().
			Comment("Public mobile device id, e.g. mob_xxx"),
		field.String("user_id").
			NotEmpty().
			Comment("Owning user id"),
		field.String("device_name"),
		field.Enum("platform").
			Values("ios", "android"),
		field.String("app_version"),
		field.Enum("status").
			Values("active", "revoked").
			Default("active"),
		field.String("access_token_hash").
			Optional().
			Sensitive().
			Comment("SHA-256 hex of the short-lived access token"),
		field.String("refresh_token_hash").
			Optional().
			Sensitive().
			Comment("SHA-256 hex of the rotating refresh token"),
		field.Time("access_expires_at").
			Optional().
			Nillable(),
		field.Time("refresh_expires_at").
			Optional().
			Nillable(),
		field.Time("created_at").
			Immutable().
			Default(time.Now),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
		field.Time("last_seen_at").
			Optional().
			Nillable(),
		field.Time("revoked_at").
			Optional().
			Nillable(),
	}
}

func (MobileDevice) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_id"),
		index.Fields("status"),
		index.Fields("access_token_hash"),
		index.Fields("refresh_token_hash"),
	}
}
