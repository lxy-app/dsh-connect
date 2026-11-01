package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// AdminSession is a browser login session for the Web Admin. The opaque token is
// stored as a SHA-256 hash; the plaintext is only ever sent to the client once.
type AdminSession struct {
	ent.Schema
}

func (AdminSession) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").
			Unique().
			NotEmpty().
			Immutable(),
		field.String("token_hash").
			Unique().
			NotEmpty().
			Sensitive(),
		field.String("user_id").
			NotEmpty(),
		field.Time("created_at").
			Immutable().
			Default(time.Now),
		field.Time("expires_at"),
		field.Time("revoked_at").
			Optional().
			Nillable(),
		field.String("source_ip").
			Optional(),
		field.String("user_agent").
			Optional(),
	}
}

func (AdminSession) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_id"),
		index.Fields("expires_at"),
	}
}
