package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// AuditEntry is an append-only record of an administrative or Connector action.
// It never contains session content.
type AuditEntry struct {
	ent.Schema
}

func (AuditEntry) Fields() []ent.Field {
	return []ent.Field{
		field.Time("occurred_at").
			Default(time.Now),
		field.String("actor").
			Comment("bootstrap | connector | user:<id>"),
		field.String("action"),
		field.String("request_id").
			Optional(),
		field.String("device_id").
			Optional(),
		field.String("session_id").
			Optional(),
		field.String("result"),
		field.String("error_code").
			Optional(),
		field.String("source_ip").
			Optional(),
		field.Bytes("details").
			Optional().
			Comment("Optional JSON metadata such as access-policy before/after changes"),
	}
}

func (AuditEntry) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("occurred_at"),
		index.Fields("device_id", "occurred_at"),
		index.Fields("action"),
	}
}
