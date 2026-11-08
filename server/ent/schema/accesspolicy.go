package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
)

// AccessPolicy grants a set of members access to desktop workspaces and scopes.
type AccessPolicy struct {
	ent.Schema
}

func (AccessPolicy) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").
			Unique().
			NotEmpty().
			Immutable().
			Comment("Public access policy id, e.g. ap_xxx"),
		field.String("name").
			Unique().
			NotEmpty(),
		field.String("description").
			Optional(),
		field.Bool("enabled").
			Default(true),
		field.JSON("member_ids", []string{}),
		field.JSON("rules", []AccessPolicyRule{}),
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

// AccessPolicyRule mirrors store.AccessPolicyRule for JSON persistence. It is
// declared here to keep the ent schema package free of internal imports.
type AccessPolicyRule struct {
	DeviceID     string   `json:"deviceId"`
	WorkspaceIDs []string `json:"workspaceIds"`
	Scopes       []string `json:"scopes"`
}
