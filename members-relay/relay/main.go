package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"
	_ "github.com/lib/pq"
)

var (
	db                 *sql.DB
	relay              *khatru.Relay
	adminPubkey        string
	relayPrivateKey    string
	relaySigningPubkey string
	relayName          string
	relayDesc          string
	relayContact       string
)

const (
	// Chat events
	KindGroupChat       = 9
	KindGroupChatReply  = 10
	KindGroupChatDelete = 11

	// Recipes
	KindRecipe = 30023

	// NIP-29 moderation events
	KindPutUser      = 9000
	KindRemoveUser   = 9001
	KindEditMetadata = 9002
	KindDeleteEvent  = 9005
	KindCreateGroup  = 9007
	KindDeleteGroup  = 9008
	KindCreateInvite = 9009

	// NIP-29 user requests
	KindJoinRequest  = 9021
	KindLeaveRequest = 9022

	// NIP-29 relay-generated metadata
	KindGroupMetadata = 39000
	KindGroupAdmins   = 39001
	KindGroupMembers  = 39002
)

func main() {
	loadConfig()
	initDB()
	defer db.Close()

	relay = khatru.NewRelay()

	relay.Info.Name = relayName
	relay.Info.Description = relayDesc
	if relaySigningPubkey != "" {
		relay.Info.PubKey = relaySigningPubkey
	} else {
		relay.Info.PubKey = adminPubkey
	}
	relay.Info.Contact = relayContact
	relay.Info.SupportedNIPs = []int{1, 11, 29, 42}
	relay.Info.Software = "khatru-members"
	relay.Info.Version = "1.0.0"

	relay.QueryEvents = append(relay.QueryEvents, queryEvents)
	relay.StoreEvent = append(relay.StoreEvent, storeEvent)
	relay.DeleteEvent = append(relay.DeleteEvent, deleteEvent)
	relay.RejectEvent = append(relay.RejectEvent, rejectEventPolicy)
	relay.RejectFilter = append(relay.RejectFilter, rejectFilterPolicy)

	port := os.Getenv("RELAY_PORT")
	if port == "" {
		port = "3334"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", relay.ServeHTTP)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	log.Printf("Starting members.zap.cooking relay on port %s", port)
	log.Printf("Admin pubkey: %s", adminPubkey)
	if relayPrivateKey != "" {
		log.Printf("NIP-29 group management: enabled (signing pubkey: %s)", relaySigningPubkey)
	} else {
		log.Println("NIP-29 group management: disabled (RELAY_PRIVATE_KEY not set)")
	}

	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}

func loadConfig() {
	adminPubkey = os.Getenv("RELAY_PUBKEY")
	if adminPubkey == "" {
		log.Fatal("RELAY_PUBKEY environment variable is required")
	}
	relayPrivateKey = os.Getenv("RELAY_PRIVATE_KEY")
	if relayPrivateKey != "" {
		pk, err := nostr.GetPublicKey(relayPrivateKey)
		if err != nil {
			log.Fatalf("Invalid RELAY_PRIVATE_KEY: %v", err)
		}
		relaySigningPubkey = pk
	}
	relayName = os.Getenv("RELAY_NAME")
	if relayName == "" {
		relayName = "Zap.Cooking Members"
	}
	relayDesc = os.Getenv("RELAY_DESCRIPTION")
	if relayDesc == "" {
		relayDesc = "Private relay for zap.cooking subscribers"
	}
	relayContact = os.Getenv("RELAY_CONTACT")
	if relayContact == "" {
		relayContact = "support@zap.cooking"
	}
}

func initDB() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}
	if err := db.Ping(); err != nil {
		log.Fatal("Failed to ping database:", err)
	}
	log.Println("Connected to PostgreSQL database")
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEMBERSHIP & GROUP HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

func isActiveMember(ctx context.Context, pubkey string) bool {
	if pubkey == adminPubkey {
		return true
	}
	var exists bool
	err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM members
			WHERE pubkey = $1
			AND status IN ('active', 'grace')
			AND subscription_end > NOW()
		)
	`, pubkey).Scan(&exists)
	if err != nil {
		log.Printf("Error checking membership for %s: %v", pubkey, err)
		return false
	}
	return exists
}

func getAuthenticatedPubkey(ctx context.Context) string {
	if pubkey := khatru.GetAuthed(ctx); pubkey != "" {
		return pubkey
	}
	return ""
}

func getHTag(event *nostr.Event) string {
	for _, tag := range event.Tags {
		if len(tag) >= 2 && tag[0] == "h" {
			return tag[1]
		}
	}
	return ""
}

func isGroupAdmin(ctx context.Context, groupId string, pubkey string) bool {
	if pubkey == adminPubkey {
		return true
	}
	var exists bool
	err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM group_members
			WHERE group_id = $1 AND pubkey = $2 AND role = 'admin'
		)
	`, groupId, pubkey).Scan(&exists)
	if err != nil {
		log.Printf("Error checking group admin for %s in %s: %v", pubkey, groupId, err)
		return false
	}
	return exists
}

func isGroupMember(ctx context.Context, groupId string, pubkey string) bool {
	if pubkey == adminPubkey {
		return true
	}
	var exists bool
	err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM group_members
			WHERE group_id = $1 AND pubkey = $2
		)
	`, groupId, pubkey).Scan(&exists)
	if err != nil {
		log.Printf("Error checking group membership for %s in %s: %v", pubkey, groupId, err)
		return false
	}
	return exists
}

func groupExists(ctx context.Context, groupId string) bool {
	var exists bool
	err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM groups WHERE id = $1)`, groupId).Scan(&exists)
	if err != nil {
		return false
	}
	return exists
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT POLICIES
// ═══════════════════════════════════════════════════════════════════════════════

func rejectEventPolicy(ctx context.Context, event *nostr.Event) (reject bool, msg string) {
	pubkey := getAuthenticatedPubkey(ctx)

	// Recipes are public (no auth required)
	if event.Kind == KindRecipe {
		return false, ""
	}

	// Everything else requires NIP-42 auth
	if pubkey == "" {
		return true, "auth-required: please authenticate with NIP-42"
	}

	// Event pubkey must match authenticated pubkey
	if event.PubKey != pubkey {
		return true, "invalid: event pubkey doesn't match authenticated user"
	}

	// --- NIP-29 Management Events ---

	// Create group (kind 9007): relay admin only
	if event.Kind == KindCreateGroup {
		if relayPrivateKey == "" {
			return true, "error: NIP-29 group management not enabled on this relay"
		}
		if pubkey != adminPubkey {
			return true, "restricted: only relay admin can create groups"
		}
		groupId := getHTag(event)
		if groupId == "" {
			return true, "invalid: missing h tag for group creation"
		}
		if groupExists(ctx, groupId) {
			return true, "duplicate: group already exists"
		}
		return false, ""
	}

	// Delete group (kind 9008): relay admin only
	if event.Kind == KindDeleteGroup {
		if pubkey != adminPubkey {
			return true, "restricted: only relay admin can delete groups"
		}
		return false, ""
	}

	// Other moderation events (9000-9006, 9009): group admin required
	if event.Kind >= 9000 && event.Kind <= 9009 {
		if !isActiveMember(ctx, pubkey) {
			return true, "restricted: membership required"
		}
		groupId := getHTag(event)
		if groupId == "" {
			return true, "invalid: missing h tag for group management event"
		}
		if !groupExists(ctx, groupId) {
			return true, "invalid: group does not exist"
		}
		if !isGroupAdmin(ctx, groupId, pubkey) {
			return true, "restricted: group admin access required"
		}
		return false, ""
	}

	// Join request (kind 9021): relay member, not already in group
	if event.Kind == KindJoinRequest {
		if !isActiveMember(ctx, pubkey) {
			return true, "restricted: relay membership required to join groups"
		}
		groupId := getHTag(event)
		if groupId == "" {
			return true, "invalid: missing h tag"
		}
		if !groupExists(ctx, groupId) {
			return true, "invalid: group does not exist"
		}
		if isGroupMember(ctx, groupId, pubkey) {
			return true, "duplicate: already a member of this group"
		}
		return false, ""
	}

	// Leave request (kind 9022): must be group member
	if event.Kind == KindLeaveRequest {
		groupId := getHTag(event)
		if groupId == "" {
			return true, "invalid: missing h tag"
		}
		if !isGroupMember(ctx, groupId, pubkey) {
			return true, "invalid: not a member of this group"
		}
		return false, ""
	}

	// Group metadata events (39000-39009): reject external submissions
	if event.Kind >= 39000 && event.Kind <= 39009 {
		return true, "invalid: group metadata events are relay-managed"
	}

	// Chat events (kind 9, 10, 11): relay member required
	if isGroupChatEvent(event.Kind) {
		if !isActiveMember(ctx, pubkey) {
			return true, "restricted: membership required for group participation"
		}
		return false, ""
	}

	// Everything else: membership required
	if !isActiveMember(ctx, pubkey) {
		return true, "restricted: membership required"
	}

	return false, ""
}

func isGroupChatEvent(kind int) bool {
	return kind == KindGroupChat || kind == KindGroupChatReply || kind == KindGroupChatDelete
}

func isGroupEvent(kind int) bool {
	// Chat events
	if isGroupChatEvent(kind) {
		return true
	}
	// Moderation events
	if kind >= 9000 && kind <= 9009 {
		return true
	}
	// User requests
	if kind == KindJoinRequest || kind == KindLeaveRequest {
		return true
	}
	// Group metadata
	if kind >= 39000 && kind <= 39009 {
		return true
	}
	return false
}

func rejectFilterPolicy(ctx context.Context, filter nostr.Filter) (reject bool, msg string) {
	pubkey := getAuthenticatedPubkey(ctx)

	if containsOnlyKind(filter.Kinds, KindRecipe) {
		return false, ""
	}

	if containsGroupKinds(filter.Kinds) {
		if pubkey == "" {
			return true, "auth-required: please authenticate to access group content"
		}
		if !isActiveMember(ctx, pubkey) {
			return true, "restricted: membership required to access group content"
		}
		return false, ""
	}

	if len(filter.Authors) == 1 && filter.Authors[0] == pubkey {
		return false, ""
	}

	if pubkey == "" {
		return true, "auth-required: please authenticate"
	}

	if !isActiveMember(ctx, pubkey) {
		return true, "restricted: membership required"
	}

	return false, ""
}

func containsOnlyKind(kinds []int, targetKind int) bool {
	if len(kinds) == 0 {
		return false
	}
	for _, k := range kinds {
		if k != targetKind {
			return false
		}
	}
	return true
}

func containsGroupKinds(kinds []int) bool {
	for _, k := range kinds {
		if isGroupEvent(k) {
			return true
		}
	}
	return false
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT STORAGE
// ═══════════════════════════════════════════════════════════════════════════════

func persistEvent(ctx context.Context, event *nostr.Event) error {
	rawJSON, err := json.Marshal(event)
	if err != nil {
		return err
	}

	var dTag *string
	if event.Kind >= 30000 && event.Kind < 40000 {
		for _, tag := range event.Tags {
			if len(tag) >= 2 && tag[0] == "d" {
				dTag = &tag[1]
				break
			}
		}
	}

	tagsJSON, _ := json.Marshal(event.Tags)

	if event.Kind >= 30000 && event.Kind < 40000 && dTag != nil {
		// Addressable events: delete previous version, then insert
		_, _ = db.ExecContext(ctx,
			"DELETE FROM events WHERE kind = $1 AND pubkey = $2 AND d_tag = $3",
			event.Kind, event.PubKey, *dTag)

		_, err = db.ExecContext(ctx, `
			INSERT INTO events (id, pubkey, kind, created_at, content, tags, sig, d_tag, raw)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			ON CONFLICT (id) DO UPDATE SET
				content = EXCLUDED.content,
				tags = EXCLUDED.tags,
				sig = EXCLUDED.sig,
				raw = EXCLUDED.raw
		`, event.ID, event.PubKey, event.Kind, time.Unix(int64(event.CreatedAt), 0),
			event.Content, tagsJSON, event.Sig, dTag, rawJSON)
	} else {
		_, err = db.ExecContext(ctx, `
			INSERT INTO events (id, pubkey, kind, created_at, content, tags, sig, raw)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			ON CONFLICT (id) DO NOTHING
		`, event.ID, event.PubKey, event.Kind, time.Unix(int64(event.CreatedAt), 0),
			event.Content, tagsJSON, event.Sig, rawJSON)
	}

	return err
}

func storeEvent(ctx context.Context, event *nostr.Event) error {
	err := persistEvent(ctx, event)
	if err != nil {
		return err
	}

	// Handle NIP-29 side effects (generate relay-signed metadata events)
	handleNIP29SideEffects(ctx, event)

	return nil
}

func deleteEvent(ctx context.Context, event *nostr.Event) error {
	pubkey := getAuthenticatedPubkey(ctx)
	if pubkey == "" || pubkey != event.PubKey {
		if pubkey != adminPubkey {
			return fmt.Errorf("unauthorized: can only delete own events")
		}
	}
	_, err := db.ExecContext(ctx, "DELETE FROM events WHERE id = $1", event.ID)
	return err
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

func queryEvents(ctx context.Context, filter nostr.Filter) (chan *nostr.Event, error) {
	ch := make(chan *nostr.Event)
	go func() {
		defer close(ch)
		query, args := buildQuery(filter)
		rows, err := db.QueryContext(ctx, query, args...)
		if err != nil {
			log.Printf("Query error: %v", err)
			return
		}
		defer rows.Close()
		for rows.Next() {
			var rawJSON []byte
			if err := rows.Scan(&rawJSON); err != nil {
				log.Printf("Scan error: %v", err)
				continue
			}
			var event nostr.Event
			if err := json.Unmarshal(rawJSON, &event); err != nil {
				log.Printf("Unmarshal error: %v", err)
				continue
			}
			select {
			case ch <- &event:
			case <-ctx.Done():
				return
			}
		}
	}()
	return ch, nil
}

func buildQuery(filter nostr.Filter) (string, []interface{}) {
	conditions := []string{}
	args := []interface{}{}
	argIndex := 1

	if len(filter.IDs) > 0 {
		placeholders := make([]string, len(filter.IDs))
		for i, id := range filter.IDs {
			placeholders[i] = fmt.Sprintf("$%d", argIndex)
			args = append(args, id)
			argIndex++
		}
		conditions = append(conditions, fmt.Sprintf("id IN (%s)", strings.Join(placeholders, ",")))
	}

	if len(filter.Authors) > 0 {
		placeholders := make([]string, len(filter.Authors))
		for i, author := range filter.Authors {
			placeholders[i] = fmt.Sprintf("$%d", argIndex)
			args = append(args, author)
			argIndex++
		}
		conditions = append(conditions, fmt.Sprintf("pubkey IN (%s)", strings.Join(placeholders, ",")))
	}

	if len(filter.Kinds) > 0 {
		placeholders := make([]string, len(filter.Kinds))
		for i, kind := range filter.Kinds {
			placeholders[i] = fmt.Sprintf("$%d", argIndex)
			args = append(args, kind)
			argIndex++
		}
		conditions = append(conditions, fmt.Sprintf("kind IN (%s)", strings.Join(placeholders, ",")))
	}

	// Tag filters (#h, #d, #p, #e, etc.)
	if filter.Tags != nil {
		for tagName, values := range filter.Tags {
			if len(values) == 0 {
				continue
			}
			tagConditions := make([]string, len(values))
			for i, val := range values {
				tagConditions[i] = fmt.Sprintf("tags @> $%d::jsonb", argIndex)
				tagJSON, _ := json.Marshal([][]string{{tagName, val}})
				args = append(args, string(tagJSON))
				argIndex++
			}
			conditions = append(conditions, "("+strings.Join(tagConditions, " OR ")+")")
		}
	}

	if filter.Since != nil {
		conditions = append(conditions, fmt.Sprintf("created_at >= $%d", argIndex))
		args = append(args, time.Unix(int64(*filter.Since), 0))
		argIndex++
	}

	if filter.Until != nil {
		conditions = append(conditions, fmt.Sprintf("created_at <= $%d", argIndex))
		args = append(args, time.Unix(int64(*filter.Until), 0))
		argIndex++
	}

	query := "SELECT raw FROM events"
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY created_at DESC"

	if filter.Limit > 0 {
		query += fmt.Sprintf(" LIMIT %d", filter.Limit)
	} else {
		query += " LIMIT 500"
	}

	return query, args
}

// ═══════════════════════════════════════════════════════════════════════════════
// NIP-29 GROUP MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

func signRelayEvent(event *nostr.Event) error {
	if relayPrivateKey == "" {
		return fmt.Errorf("relay private key not configured")
	}
	event.PubKey = relaySigningPubkey
	event.CreatedAt = nostr.Timestamp(time.Now().Unix())
	return event.Sign(relayPrivateKey)
}

func handleNIP29SideEffects(ctx context.Context, event *nostr.Event) {
	if relayPrivateKey == "" {
		return
	}

	switch event.Kind {
	case KindCreateGroup:
		handleCreateGroup(ctx, event)
	case KindEditMetadata:
		handleEditMetadata(ctx, event)
	case KindPutUser:
		handlePutUser(ctx, event)
	case KindRemoveUser:
		handleRemoveUser(ctx, event)
	case KindJoinRequest:
		handleJoinRequest(ctx, event)
	case KindLeaveRequest:
		handleLeaveRequest(ctx, event)
	case KindDeleteEvent:
		handleDeleteGroupEvent(ctx, event)
	case KindDeleteGroup:
		handleDeleteGroup(ctx, event)
	}
}

func handleCreateGroup(ctx context.Context, event *nostr.Event) {
	groupId := getHTag(event)
	if groupId == "" {
		return
	}

	log.Printf("[NIP-29] Creating group: %s (by %s)", groupId, event.PubKey)

	// Insert into groups table
	_, err := db.ExecContext(ctx, `
		INSERT INTO groups (id, name, description, is_public, is_open, created_by)
		VALUES ($1, $2, $3, false, false, $4)
		ON CONFLICT (id) DO NOTHING
	`, groupId, groupId, "", event.PubKey)
	if err != nil {
		log.Printf("[NIP-29] Error creating group record: %v", err)
		return
	}

	// Add creator as group admin
	_, err = db.ExecContext(ctx, `
		INSERT INTO group_members (group_id, pubkey, role)
		VALUES ($1, $2, 'admin')
		ON CONFLICT (group_id, pubkey) DO UPDATE SET role = 'admin'
	`, groupId, event.PubKey)
	if err != nil {
		log.Printf("[NIP-29] Error adding creator as admin: %v", err)
	}

	// Generate kind 39000 (group metadata)
	generateGroupMetadata(ctx, groupId)

	// Generate kind 39001 (group admins)
	generateGroupAdmins(ctx, groupId)

	// Generate kind 39002 (group members)
	generateGroupMembers(ctx, groupId)

	log.Printf("[NIP-29] Group %s created successfully", groupId)
}

func handleEditMetadata(ctx context.Context, event *nostr.Event) {
	groupId := getHTag(event)
	if groupId == "" {
		return
	}

	log.Printf("[NIP-29] Editing metadata for group: %s", groupId)

	// Extract metadata from event tags
	var name, description, pictureURL string
	for _, tag := range event.Tags {
		if len(tag) < 2 {
			continue
		}
		switch tag[0] {
		case "name":
			name = tag[1]
		case "about":
			description = tag[1]
		case "picture":
			pictureURL = tag[1]
		}
	}

	// Update groups table
	if name != "" {
		db.ExecContext(ctx, "UPDATE groups SET name = $1, updated_at = NOW() WHERE id = $2", name, groupId)
	}
	if description != "" {
		db.ExecContext(ctx, "UPDATE groups SET description = $1, updated_at = NOW() WHERE id = $2", description, groupId)
	}
	if pictureURL != "" {
		db.ExecContext(ctx, "UPDATE groups SET picture_url = $1, updated_at = NOW() WHERE id = $2", pictureURL, groupId)
	}

	// Check for visibility/access tags
	for _, tag := range event.Tags {
		if len(tag) < 1 {
			continue
		}
		switch tag[0] {
		case "public":
			db.ExecContext(ctx, "UPDATE groups SET is_public = true, updated_at = NOW() WHERE id = $1", groupId)
		case "private":
			db.ExecContext(ctx, "UPDATE groups SET is_public = false, updated_at = NOW() WHERE id = $1", groupId)
		case "open":
			db.ExecContext(ctx, "UPDATE groups SET is_open = true, updated_at = NOW() WHERE id = $1", groupId)
		case "closed":
			db.ExecContext(ctx, "UPDATE groups SET is_open = false, updated_at = NOW() WHERE id = $1", groupId)
		}
	}

	// Regenerate kind 39000
	generateGroupMetadata(ctx, groupId)
}

func handlePutUser(ctx context.Context, event *nostr.Event) {
	groupId := getHTag(event)
	if groupId == "" {
		return
	}

	for _, tag := range event.Tags {
		if len(tag) < 2 || tag[0] != "p" {
			continue
		}
		userPubkey := tag[1]
		role := "member"
		if len(tag) >= 3 && tag[2] != "" {
			role = tag[2]
		}

		log.Printf("[NIP-29] Adding user %s to group %s with role %s", userPubkey, groupId, role)

		_, err := db.ExecContext(ctx, `
			INSERT INTO group_members (group_id, pubkey, role)
			VALUES ($1, $2, $3)
			ON CONFLICT (group_id, pubkey) DO UPDATE SET role = $3
		`, groupId, userPubkey, role)
		if err != nil {
			log.Printf("[NIP-29] Error adding user: %v", err)
		}
	}

	// Regenerate metadata events
	generateGroupAdmins(ctx, groupId)
	generateGroupMembers(ctx, groupId)
}

func handleRemoveUser(ctx context.Context, event *nostr.Event) {
	groupId := getHTag(event)
	if groupId == "" {
		return
	}

	for _, tag := range event.Tags {
		if len(tag) < 2 || tag[0] != "p" {
			continue
		}
		userPubkey := tag[1]

		log.Printf("[NIP-29] Removing user %s from group %s", userPubkey, groupId)

		_, err := db.ExecContext(ctx, `
			DELETE FROM group_members WHERE group_id = $1 AND pubkey = $2
		`, groupId, userPubkey)
		if err != nil {
			log.Printf("[NIP-29] Error removing user: %v", err)
		}
	}

	generateGroupAdmins(ctx, groupId)
	generateGroupMembers(ctx, groupId)
}

func handleJoinRequest(ctx context.Context, event *nostr.Event) {
	groupId := getHTag(event)
	if groupId == "" {
		return
	}

	log.Printf("[NIP-29] Join request from %s for group %s — auto-approving", event.PubKey, groupId)

	// Auto-approve: add as member
	_, err := db.ExecContext(ctx, `
		INSERT INTO group_members (group_id, pubkey, role)
		VALUES ($1, $2, 'member')
		ON CONFLICT (group_id, pubkey) DO NOTHING
	`, groupId, event.PubKey)
	if err != nil {
		log.Printf("[NIP-29] Error auto-approving join: %v", err)
		return
	}

	// Generate a kind 9000 (put-user) event signed by relay to confirm
	putEvent := nostr.Event{
		Kind:    KindPutUser,
		Content: "",
		Tags: nostr.Tags{
			{"h", groupId},
			{"p", event.PubKey, "member"},
		},
	}
	if err := signRelayEvent(&putEvent); err != nil {
		log.Printf("[NIP-29] Error signing put-user event: %v", err)
		return
	}
	if err := persistEvent(ctx, &putEvent); err != nil {
		log.Printf("[NIP-29] Error storing put-user event: %v", err)
	}

	// Update members list
	generateGroupMembers(ctx, groupId)
}

func handleLeaveRequest(ctx context.Context, event *nostr.Event) {
	groupId := getHTag(event)
	if groupId == "" {
		return
	}

	log.Printf("[NIP-29] Leave request from %s for group %s", event.PubKey, groupId)

	_, err := db.ExecContext(ctx, `
		DELETE FROM group_members WHERE group_id = $1 AND pubkey = $2
	`, groupId, event.PubKey)
	if err != nil {
		log.Printf("[NIP-29] Error processing leave: %v", err)
		return
	}

	// Generate a kind 9001 (remove-user) event signed by relay to confirm
	removeEvent := nostr.Event{
		Kind:    KindRemoveUser,
		Content: "",
		Tags: nostr.Tags{
			{"h", groupId},
			{"p", event.PubKey},
		},
	}
	if err := signRelayEvent(&removeEvent); err != nil {
		log.Printf("[NIP-29] Error signing remove-user event: %v", err)
		return
	}
	if err := persistEvent(ctx, &removeEvent); err != nil {
		log.Printf("[NIP-29] Error storing remove-user event: %v", err)
	}

	generateGroupAdmins(ctx, groupId)
	generateGroupMembers(ctx, groupId)
}

func handleDeleteGroupEvent(ctx context.Context, event *nostr.Event) {
	for _, tag := range event.Tags {
		if len(tag) >= 2 && tag[0] == "e" {
			eventId := tag[1]
			log.Printf("[NIP-29] Deleting event %s from group", eventId)
			_, err := db.ExecContext(ctx, "DELETE FROM events WHERE id = $1", eventId)
			if err != nil {
				log.Printf("[NIP-29] Error deleting event: %v", err)
			}
		}
	}
}

func handleDeleteGroup(ctx context.Context, event *nostr.Event) {
	groupId := getHTag(event)
	if groupId == "" {
		return
	}

	log.Printf("[NIP-29] Deleting group: %s", groupId)

	// Delete group members
	db.ExecContext(ctx, "DELETE FROM group_members WHERE group_id = $1", groupId)
	// Delete group bans
	db.ExecContext(ctx, "DELETE FROM group_bans WHERE group_id = $1", groupId)
	// Delete group metadata events
	db.ExecContext(ctx, "DELETE FROM events WHERE kind IN ($1, $2, $3) AND d_tag = $4",
		KindGroupMetadata, KindGroupAdmins, KindGroupMembers, groupId)
	// Delete group chat events (with h tag matching)
	db.ExecContext(ctx, `DELETE FROM events WHERE tags @> $1::jsonb AND kind IN ($2, $3, $4)`,
		fmt.Sprintf(`[["h","%s"]]`, groupId), KindGroupChat, KindGroupChatReply, KindGroupChatDelete)
	// Delete group record
	db.ExecContext(ctx, "DELETE FROM groups WHERE id = $1", groupId)

	log.Printf("[NIP-29] Group %s deleted", groupId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// RELAY-SIGNED METADATA EVENT GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

func generateGroupMetadata(ctx context.Context, groupId string) {
	// Fetch group info from DB
	var name, description string
	var pictureURL sql.NullString
	var isPublic, isOpen bool
	err := db.QueryRowContext(ctx, `
		SELECT name, COALESCE(description, ''), picture_url, is_public, is_open
		FROM groups WHERE id = $1
	`, groupId).Scan(&name, &description, &pictureURL, &isPublic, &isOpen)
	if err != nil {
		log.Printf("[NIP-29] Error fetching group for metadata: %v", err)
		return
	}

	tags := nostr.Tags{
		{"d", groupId},
		{"name", name},
	}
	if description != "" {
		tags = append(tags, nostr.Tag{"about", description})
	}
	if pictureURL.Valid && pictureURL.String != "" {
		tags = append(tags, nostr.Tag{"picture", pictureURL.String})
	}
	if !isPublic {
		tags = append(tags, nostr.Tag{"private"})
	}
	if !isOpen {
		tags = append(tags, nostr.Tag{"closed"})
	}

	event := nostr.Event{
		Kind:    KindGroupMetadata,
		Content: "",
		Tags:    tags,
	}

	if err := signRelayEvent(&event); err != nil {
		log.Printf("[NIP-29] Error signing group metadata: %v", err)
		return
	}
	if err := persistEvent(ctx, &event); err != nil {
		log.Printf("[NIP-29] Error storing group metadata: %v", err)
	}
}

func generateGroupAdmins(ctx context.Context, groupId string) {
	rows, err := db.QueryContext(ctx, `
		SELECT pubkey, role FROM group_members
		WHERE group_id = $1 AND role IN ('admin', 'moderator')
		ORDER BY joined_at
	`, groupId)
	if err != nil {
		log.Printf("[NIP-29] Error fetching group admins: %v", err)
		return
	}
	defer rows.Close()

	tags := nostr.Tags{
		{"d", groupId},
	}
	for rows.Next() {
		var pubkey, role string
		if err := rows.Scan(&pubkey, &role); err != nil {
			continue
		}
		tags = append(tags, nostr.Tag{"p", pubkey, role})
	}

	event := nostr.Event{
		Kind:    KindGroupAdmins,
		Content: "",
		Tags:    tags,
	}

	if err := signRelayEvent(&event); err != nil {
		log.Printf("[NIP-29] Error signing group admins: %v", err)
		return
	}
	if err := persistEvent(ctx, &event); err != nil {
		log.Printf("[NIP-29] Error storing group admins: %v", err)
	}
}

func generateGroupMembers(ctx context.Context, groupId string) {
	rows, err := db.QueryContext(ctx, `
		SELECT pubkey FROM group_members
		WHERE group_id = $1
		ORDER BY joined_at
	`, groupId)
	if err != nil {
		log.Printf("[NIP-29] Error fetching group members: %v", err)
		return
	}
	defer rows.Close()

	tags := nostr.Tags{
		{"d", groupId},
	}
	for rows.Next() {
		var pubkey string
		if err := rows.Scan(&pubkey); err != nil {
			continue
		}
		tags = append(tags, nostr.Tag{"p", pubkey})
	}

	event := nostr.Event{
		Kind:    KindGroupMembers,
		Content: "",
		Tags:    tags,
	}

	if err := signRelayEvent(&event); err != nil {
		log.Printf("[NIP-29] Error signing group members: %v", err)
		return
	}
	if err := persistEvent(ctx, &event); err != nil {
		log.Printf("[NIP-29] Error storing group members: %v", err)
	}
}
