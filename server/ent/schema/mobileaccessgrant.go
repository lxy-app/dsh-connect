package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// MobileAccessGrant records the desktop user's explicit decision to let one
// paired phone reach a subset of this desktop's workspaces and scopes. A phone
// pairing alone never implies access: the row starts as pending and only the
// desktop Connector can activate or revoke it.
type MobileAccessGrant struct {
	ent.Schema
}

func (MobileAccessGrant) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").
			Unique().
			NotEmpty().
			Immutable().
			Comment("Public grant id, e.g. mag_xxx"),
		field.String("mobile_device_id").
			NotEmpty().
			Comment("Paired phone requesting access"),
		field.String("device_id").
			NotEmpty().
			Comment("Desktop device that owns the workspaces"),
		field.String("user_id").
			NotEmpty().
			Comment("Owner of the phone; grants never cross users"),
		field.JSON("workspaces", []Workspace{}).
			Comment("Requested/granted workspaces as an ordered JSON array"),
		field.JSON("scopes", []string{}).
			Comment("Requested/granted scopes: read, prompt, cancel"),
		field.Enum("status").
			Values("pending", "active", "denied", "revoked").
			Default("pending"),
		field.Time("created_at").
			Immutable().
			Default(time.Now),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
		field.Time("decided_at").
			Optional().
			Nillable(),
	}
}

func (MobileAccessGrant) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("mobile_device_id", "device_id").Unique(),
		index.Fields("device_id", "status"),
		index.Fields("user_id"),
	}
}
