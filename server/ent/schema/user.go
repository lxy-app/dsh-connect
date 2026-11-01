package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// User is an administrative operator of DSH Connect.
type User struct {
	ent.Schema
}

func (User) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").
			Unique().
			NotEmpty().
			Immutable().
			Comment("Public user id, e.g. usr_xxx"),
		field.String("email").
			Unique().
			NotEmpty().
			Comment("Lowercased login email"),
		field.String("display_name"),
		field.String("password_hash").
			Sensitive().
			Comment("bcrypt hash"),
		field.Enum("role").
			Values("owner", "admin", "member", "auditor").
			Default("member"),
		field.Enum("status").
			Values("active", "disabled").
			Default("active"),
		field.Time("last_login_at").
			Optional().
			Nillable(),
		field.Time("created_at").
			Immutable().
			Default(time.Now),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

func (User) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("role"),
		index.Fields("status"),
	}
}
