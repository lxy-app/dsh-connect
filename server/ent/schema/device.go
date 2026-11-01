package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// Device is a desktop that paired through a Connector. Credentials are stored
// as SHA-256 hashes only, never as plaintext.
type Device struct {
	ent.Schema
}

func (Device) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").
			Unique().
			NotEmpty().
			Immutable().
			Comment("Public device id, e.g. dev_xxx"),
		field.String("device_name"),
		field.String("fingerprint"),
		field.String("connector_version"),
		field.String("status").
			Default("waiting_desktop_authorization").
			Comment("waiting_desktop_authorization | online | offline | revoked"),
		field.JSON("workspaces", []Workspace{}).
			Comment("Authorized workspaces as an ordered JSON array"),
		field.JSON("scopes", []string{}).
			Comment("Granted scopes: read, prompt, cancel"),
		field.String("device_token_hash").
			Optional().
			Sensitive().
			Comment("SHA-256 hex of the long-lived device token"),
		field.String("pairing_token_hash").
			Optional().
			Sensitive().
			Comment("SHA-256 hex of the one-time pairing token"),
		field.Time("pairing_expires_at").
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
	}
}

func (Device) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("status"),
		index.Fields("device_token_hash"),
	}
}

// Workspace mirrors protocol.Workspace for JSON persistence. It is declared
// here to keep the ent schema package free of internal imports.
type Workspace struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
}
