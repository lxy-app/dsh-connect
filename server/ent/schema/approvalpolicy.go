package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
)

// ApprovalPolicy is the singleton remote-approval policy for this Server.
type ApprovalPolicy struct {
	ent.Schema
}

func (ApprovalPolicy) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").
			Unique().
			NotEmpty().
			Immutable().
			Comment("Singleton policy id; always default"),
		field.Bool("remote_enabled").
			Default(true),
		field.Int("ttl_seconds").
			Default(600).
			Min(30).
			Max(600),
		field.Int64("revision").
			Default(1),
		field.Time("created_at").
			Immutable().
			Default(time.Now),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}
