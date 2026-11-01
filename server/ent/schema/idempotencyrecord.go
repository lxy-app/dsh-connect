package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// IdempotencyRecord stores the durable outcome of a session.prompt request so
// that a repeated requestId never reaches the Connector twice.
type IdempotencyRecord struct {
	ent.Schema
}

func (IdempotencyRecord) Fields() []ent.Field {
	return []ent.Field{
		field.String("request_id").
			Unique().
			NotEmpty().
			Immutable().
			Comment("Client-supplied idempotency key"),
		field.String("method"),
		field.String("device_id"),
		field.String("request_hash").
			Comment("SHA-256 over method, device and normalized params"),
		field.Bytes("result").
			Optional().
			Nillable().
			Comment("Raw JSON command result"),
		field.String("error_code").
			Optional(),
		field.String("error_message").
			Optional(),
		field.Bool("error_retryable").
			Default(false),
		field.Bytes("error_details").
			Optional().
			Nillable(),
		field.Time("created_at").
			Immutable().
			Default(time.Now),
		field.Time("completed_at"),
	}
}

func (IdempotencyRecord) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("device_id"),
	}
}
