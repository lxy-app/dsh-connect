package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/deepseek/dsh-connect/server/ent"
	"github.com/deepseek/dsh-connect/server/ent/adminsession"
	"github.com/deepseek/dsh-connect/server/ent/mobileaccessgrant"
	"github.com/deepseek/dsh-connect/server/ent/mobiledevice"
	"github.com/deepseek/dsh-connect/server/ent/mobilepairingcode"
	"github.com/deepseek/dsh-connect/server/ent/user"
	"golang.org/x/crypto/bcrypt"
)

// Role values mirror the ent enum so API handlers do not import ent predicates.
const (
	RoleOwner   = "owner"
	RoleAdmin   = "admin"
	RoleMember  = "member"
	RoleAuditor = "auditor"

	UserStatusActive   = "active"
	UserStatusDisabled = "disabled"
)

// User is the administrative operator projection. PasswordHash is never exposed
// outside this package.
type User struct {
	ID           string     `json:"id"`
	Email        string     `json:"email"`
	DisplayName  string     `json:"displayName"`
	Role         string     `json:"role"`
	Status       string     `json:"status"`
	LastLoginAt  *time.Time `json:"lastLoginAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
	PasswordHash string     `json:"-"`
}

func toUser(record *ent.User) User {
	return User{
		ID:           record.ID,
		Email:        record.Email,
		DisplayName:  record.DisplayName,
		Role:         string(record.Role),
		Status:       string(record.Status),
		LastLoginAt:  record.LastLoginAt,
		CreatedAt:    record.CreatedAt,
		UpdatedAt:    record.UpdatedAt,
		PasswordHash: record.PasswordHash,
	}
}

// NormalizeEmail lowercases and trims an email for storage and lookup.
func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// HashPassword returns a bcrypt hash suitable for storage.
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return string(hash), nil
}

// CheckPassword reports whether the plaintext matches the stored hash.
func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// CreateUser inserts an administrative user with a bcrypt password hash.
func (s *Store) CreateUser(ctx context.Context, userID, email, displayName, password, role string) (User, error) {
	hash, err := HashPassword(password)
	if err != nil {
		return User{}, err
	}
	created, err := s.client.User.Create().
		SetID(userID).
		SetEmail(NormalizeEmail(email)).
		SetDisplayName(displayName).
		SetPasswordHash(hash).
		SetRole(user.Role(role)).
		SetStatus(user.StatusActive).
		Save(ctx)
	if err != nil {
		if ent.IsConstraintError(err) {
			return User{}, ErrUserEmailTaken
		}
		return User{}, fmt.Errorf("create user: %w", err)
	}
	return toUser(created), nil
}

// EnsureOwner creates the first owner account when no user exists yet. It is
// idempotent: an existing owner leaves the database untouched. An empty
// password skips seeding so a fresh database never gets a blank credential.
func (s *Store) EnsureOwner(ctx context.Context, userID, email, displayName, password string) (User, bool, error) {
	count, err := s.client.User.Query().Count(ctx)
	if err != nil {
		return User{}, false, fmt.Errorf("count users: %w", err)
	}
	if count > 0 {
		existing, err := s.client.User.Query().
			Where(user.RoleEQ(user.RoleOwner)).
			Order(ent.Asc(user.FieldCreatedAt)).
			First(ctx)
		if ent.IsNotFound(err) {
			return User{}, false, nil
		}
		if err != nil {
			return User{}, false, fmt.Errorf("load owner: %w", err)
		}
		return toUser(existing), false, nil
	}
	if email == "" || password == "" {
		return User{}, false, nil
	}
	if displayName == "" {
		displayName = "Owner"
	}
	created, err := s.CreateUser(ctx, userID, email, displayName, password, RoleOwner)
	if err != nil {
		return User{}, false, err
	}
	return created, true, nil
}

// UserByEmail loads a user by lowercased email.
func (s *Store) UserByEmail(ctx context.Context, email string) (User, error) {
	record, err := s.client.User.Query().
		Where(user.EmailEQ(NormalizeEmail(email))).
		Only(ctx)
	if ent.IsNotFound(err) {
		return User{}, ErrUserNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("load user by email: %w", err)
	}
	return toUser(record), nil
}

// UserByID loads a user by public id.
func (s *Store) UserByID(ctx context.Context, userID string) (User, error) {
	record, err := s.client.User.Query().Where(user.IDEQ(userID)).Only(ctx)
	if ent.IsNotFound(err) {
		return User{}, ErrUserNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("load user by id: %w", err)
	}
	return toUser(record), nil
}

// Users lists administrative users ordered by creation time.
func (s *Store) Users(ctx context.Context) ([]User, error) {
	records, err := s.client.User.Query().Order(ent.Asc(user.FieldCreatedAt)).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	result := make([]User, 0, len(records))
	for _, record := range records {
		result = append(result, toUser(record))
	}
	return result, nil
}

// UserUpdate carries optional administrative user changes.
type UserUpdate struct {
	DisplayName *string
	Role        *string
	Status      *string
	Password    *string
}

// UpdateUser applies a partial update to a user.
func (s *Store) UpdateUser(ctx context.Context, userID string, update UserUpdate) (User, error) {
	builder := s.client.User.Update().Where(user.IDEQ(userID)).SetUpdatedAt(time.Now().UTC())
	if update.DisplayName != nil {
		builder.SetDisplayName(*update.DisplayName)
	}
	if update.Role != nil {
		builder.SetRole(user.Role(*update.Role))
	}
	if update.Status != nil {
		builder.SetStatus(user.Status(*update.Status))
	}
	if update.Password != nil {
		hash, err := HashPassword(*update.Password)
		if err != nil {
			return User{}, err
		}
		builder.SetPasswordHash(hash)
	}
	affected, err := builder.Save(ctx)
	if err != nil {
		return User{}, fmt.Errorf("update user: %w", err)
	}
	if affected == 0 {
		return User{}, ErrUserNotFound
	}
	return s.UserByID(ctx, userID)
}

// DeleteUser removes a user and revokes their admin sessions, mobile devices and
// outstanding mobile pairing codes.
func (s *Store) DeleteUser(ctx context.Context, userID string) error {
	if _, err := s.client.AdminSession.Delete().
		Where(adminsession.UserIDEQ(userID)).
		Exec(ctx); err != nil {
		return fmt.Errorf("delete user sessions: %w", err)
	}
	if _, err := s.client.MobileAccessGrant.Delete().
		Where(mobileaccessgrant.UserIDEQ(userID)).
		Exec(ctx); err != nil {
		return fmt.Errorf("delete user mobile access grants: %w", err)
	}
	if _, err := s.client.MobileDevice.Delete().
		Where(mobiledevice.UserIDEQ(userID)).
		Exec(ctx); err != nil {
		return fmt.Errorf("delete user mobile devices: %w", err)
	}
	if _, err := s.client.MobilePairingCode.Delete().
		Where(mobilepairingcode.UserIDEQ(userID)).
		Exec(ctx); err != nil {
		return fmt.Errorf("delete user mobile pairing codes: %w", err)
	}
	affected, err := s.client.User.Delete().Where(user.IDEQ(userID)).Exec(ctx)
	if err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	if affected == 0 {
		return ErrUserNotFound
	}
	return nil
}

// CountOwners reports how many owner accounts exist; used to block removing the
// last owner.
func (s *Store) CountOwners(ctx context.Context) (int, error) {
	count, err := s.client.User.Query().Where(user.RoleEQ(user.RoleOwner)).Count(ctx)
	if err != nil {
		return 0, fmt.Errorf("count owners: %w", err)
	}
	return count, nil
}

// AdminSession is a browser login session for the Web Admin.
type AdminSession struct {
	ID        string
	UserID    string
	ExpiresAt time.Time
	SourceIP  string
	UserAgent string
}

// CreateAdminSession stores a hashed session token and returns the plaintext to
// hand back to the browser.
func (s *Store) CreateAdminSession(ctx context.Context, token, sessionID, userID string, ttl time.Duration, sourceIP, userAgent string) (string, error) {
	now := time.Now().UTC().Truncate(time.Millisecond)
	expiresAt := now.Add(ttl)
	if _, err := s.client.AdminSession.Create().
		SetID(sessionID).
		SetTokenHash(HashToken(token)).
		SetUserID(userID).
		SetCreatedAt(now).
		SetExpiresAt(expiresAt).
		SetSourceIP(sourceIP).
		SetUserAgent(userAgent).
		Save(ctx); err != nil {
		return "", fmt.Errorf("create admin session: %w", err)
	}
	if _, err := s.client.User.Update().
		Where(user.IDEQ(userID)).
		SetLastLoginAt(now).
		SetUpdatedAt(now).
		Save(ctx); err != nil {
		return "", fmt.Errorf("record last login: %w", err)
	}
	return token, nil
}

// AdminSessionUser resolves a plaintext session token to its active user.
func (s *Store) AdminSessionUser(ctx context.Context, token string, now time.Time) (User, error) {
	session, err := s.client.AdminSession.Query().
		Where(adminsession.TokenHash(HashToken(token))).
		Only(ctx)
	if ent.IsNotFound(err) {
		return User{}, ErrSessionInvalid
	}
	if err != nil {
		return User{}, fmt.Errorf("load admin session: %w", err)
	}
	if session.RevokedAt != nil || !now.Before(session.ExpiresAt) {
		return User{}, ErrSessionInvalid
	}
	record, err := s.client.User.Query().Where(user.IDEQ(session.UserID)).Only(ctx)
	if ent.IsNotFound(err) {
		return User{}, ErrSessionInvalid
	}
	if err != nil {
		return User{}, fmt.Errorf("load session user: %w", err)
	}
	if record.Status != user.StatusActive {
		return User{}, ErrSessionInvalid
	}
	return toUser(record), nil
}

// RevokeAdminSession invalidates a single session token.
func (s *Store) RevokeAdminSession(ctx context.Context, token string) error {
	affected, err := s.client.AdminSession.Update().
		Where(
			adminsession.TokenHash(HashToken(token)),
			adminsession.RevokedAtIsNil(),
		).
		SetRevokedAt(time.Now().UTC()).
		Save(ctx)
	if err != nil {
		return fmt.Errorf("revoke admin session: %w", err)
	}
	if affected == 0 {
		return ErrSessionInvalid
	}
	return nil
}

// PurgeExpiredAdminSessions deletes sessions that expired before the cutoff.
func (s *Store) PurgeExpiredAdminSessions(ctx context.Context, before time.Time) error {
	if _, err := s.client.AdminSession.Delete().
		Where(adminsession.ExpiresAtLT(before)).
		Exec(ctx); err != nil {
		return fmt.Errorf("purge expired sessions: %w", err)
	}
	return nil
}

var _ = errors.Is
