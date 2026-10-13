package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"
)

// persistedState is what survives a backend restart: sessions (so players
// stay logged in and keep their email-bound names), the leaderboard, and each
// player's latest code/metrics for the admin dashboard.
type persistedState struct {
	Version      int                      `json:"version"`
	Sessions     []*Session               `json:"sessions"`
	Leaderboard  []ScoreEntry             `json:"leaderboard"`
	PlayerStates map[string]*StudentState `json:"playerStates"`
}

// dirty is set whenever the hub state changes; the saver writes only then.
var dirty atomic.Bool

func markDirty() { dirty.Store(true) }

func (h *Hub) snapshot() persistedState {
	st := persistedState{Version: 1, PlayerStates: map[string]*StudentState{}}

	h.sessionsMu.RLock()
	for _, s := range h.sessions {
		c := *s
		st.Sessions = append(st.Sessions, &c)
	}
	h.sessionsMu.RUnlock()

	h.leaderboardMu.RLock()
	for _, e := range h.leaderboard {
		st.Leaderboard = append(st.Leaderboard, e)
	}
	h.leaderboardMu.RUnlock()

	h.stateMu.RLock()
	for name, s := range h.studentStates {
		codes := make(map[string]json.RawMessage, len(s.Codes))
		for k, v := range s.Codes {
			codes[k] = v
		}
		st.PlayerStates[name] = &StudentState{Name: s.Name, Codes: codes, Metrics: s.Metrics}
	}
	h.stateMu.RUnlock()
	return st
}

// LoadState restores the hub from path. A missing file is not an error.
func (h *Hub) LoadState(path string) error {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		log.Printf("[STATE] No state file at %s, starting fresh", path)
		return nil
	}
	if err != nil {
		return err
	}
	var st persistedState
	if err := json.Unmarshal(data, &st); err != nil {
		return err
	}

	h.sessionsMu.Lock()
	for _, s := range st.Sessions {
		h.sessions[s.Token] = s
	}
	h.sessionsMu.Unlock()

	h.leaderboardMu.Lock()
	for _, e := range st.Leaderboard {
		h.leaderboard[e.UserName] = e
	}
	h.leaderboardMu.Unlock()

	h.stateMu.Lock()
	for name, s := range st.PlayerStates {
		s.Connected = false // everyone shows online again when they reconnect
		if s.Codes == nil {
			s.Codes = map[string]json.RawMessage{}
		}
		h.studentStates[name] = s
	}
	h.stateMu.Unlock()

	log.Printf("[STATE] Restored %d sessions, %d scores, %d players from %s",
		len(st.Sessions), len(st.Leaderboard), len(st.PlayerStates), path)
	return nil
}

// SaveState writes the state atomically (temp file + rename).
func (h *Hub) SaveState(path string) error {
	data, err := json.Marshal(h.snapshot())
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".arena-state-*.tmp")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// RunSaver saves the state every interval when something changed.
func (h *Hub) RunSaver(path string, interval time.Duration) {
	for range time.Tick(interval) {
		if dirty.Swap(false) {
			if err := h.SaveState(path); err != nil {
				log.Printf("[STATE] Save failed: %v", err)
				markDirty() // retry next tick
			}
		}
	}
}
