package server

import (
	"context"
	"log"
	"net/http"
	"sync"

	"github.com/deepseek/dsh-connect/server/internal/store"
)

type Server struct {
	config          Config
	store           *store.Store
	hub             *Hub
	events          *EventHub
	interactions    *InteractionStore
	router          *Router
	attachmentBlobs attachmentBlobs
	handler         http.Handler
	closeOnce       sync.Once
}

func New(ctx context.Context, config Config) (*Server, error) {
	config, err := config.withDefaults()
	if err != nil {
		return nil, err
	}
	persistentStore, err := store.Open(ctx, config.DatabaseURL)
	if err != nil {
		return nil, err
	}
	if err := persistentStore.Migrate(ctx); err != nil {
		_ = persistentStore.Close()
		return nil, err
	}
	// A fetching command cannot outlive the process that issued it. Release
	// those rows so a restart does not leave mobile downloads pending forever.
	if err := persistentStore.RecoverAttachmentFetches(ctx, nowUTC()); err != nil {
		_ = persistentStore.Close()
		return nil, err
	}
	// No Connector can be connected before the listener starts, so any persisted
	// "online" status is stale.
	if err := persistentStore.SetAllOffline(ctx, nowUTC()); err != nil {
		_ = persistentStore.Close()
		return nil, err
	}
	if err := bootstrapOwner(ctx, persistentStore, config); err != nil {
		_ = persistentStore.Close()
		return nil, err
	}
	s := &Server{
		config:          config,
		store:           persistentStore,
		hub:             NewHub(),
		events:          NewEventHub(config.EventBuffer),
		interactions:    NewInteractionStore(interactionMaxTTL),
		attachmentBlobs: attachmentBlobs{dir: config.AttachmentDir},
	}
	s.router = NewRouter(s)
	s.handler = s.routes()
	return s, nil
}

// bootstrapOwner seeds the first owner account so a fresh database is usable.
func bootstrapOwner(ctx context.Context, persistentStore *store.Store, config Config) error {
	owner, created, err := persistentStore.EnsureOwner(
		ctx,
		"usr_owner",
		config.BootstrapOwnerEmail,
		config.BootstrapOwnerName,
		config.BootstrapOwnerPassword,
	)
	if err != nil {
		return err
	}
	if created {
		log.Printf("created bootstrap owner account %s", owner.Email)
	}
	return nil
}

func (s *Server) Handler() http.Handler {
	return s.handler
}

// Store exposes the persistence layer for tests and administrative handlers.
func (s *Server) Store() *store.Store {
	return s.store
}

func (s *Server) Close() {
	s.closeOnce.Do(func() {
		s.hub.CloseAll()
		s.events.CloseAll()
		if s.store != nil {
			if err := s.store.Close(); err != nil {
				log.Printf("close store: %v", err)
			}
		}
	})
}

func (s *Server) audit(entry store.AuditEntry) {
	if err := s.store.AppendAudit(context.Background(), entry); err != nil {
		log.Printf("persist audit action=%s requestId=%s: %v", entry.Action, entry.RequestID, err)
	}
}
