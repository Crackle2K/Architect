package discord

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

const baseURL = "https://discord.com/api/v9"

type Client struct {
	token      string
	httpClient *http.Client
}

func NewClient(token string) *Client {
	return &Client{
		token:      token,
		httpClient: &http.Client{},
	}
}

func (c *Client) do(method, path string, body any) ([]byte, error) {
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reqBody = bytes.NewReader(b)
	}

	req, err := http.NewRequest(method, baseURL+path, reqBody)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", c.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var apiErr struct {
			Message string `json:"message"`
			Code    int    `json:"code"`
		}
		if json.Unmarshal(data, &apiErr) == nil && apiErr.Message != "" {
			return nil, fmt.Errorf("discord API error %d: %s", resp.StatusCode, apiErr.Message)
		}
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(data))
	}

	return data, nil
}

// GetCurrentUser returns the authenticated user's profile.
func (c *Client) GetCurrentUser() (*User, error) {
	data, err := c.do("GET", "/users/@me", nil)
	if err != nil {
		return nil, err
	}
	var u User
	return &u, json.Unmarshal(data, &u)
}

// GetFriends returns the user's friend list (relationships of type 1).
func (c *Client) GetFriends() ([]Relationship, error) {
	data, err := c.do("GET", "/users/@me/relationships", nil)
	if err != nil {
		return nil, err
	}
	var all []Relationship
	if err := json.Unmarshal(data, &all); err != nil {
		return nil, err
	}
	var friends []Relationship
	for _, r := range all {
		if r.Type == 1 { // 1 = friend
			friends = append(friends, r)
		}
	}
	return friends, nil
}

// OpenDM creates or retrieves a DM channel with the given user ID.
func (c *Client) OpenDM(recipientID string) (string, error) {
	payload := map[string]string{"recipient_id": recipientID}
	data, err := c.do("POST", "/users/@me/channels", payload)
	if err != nil {
		return "", err
	}
	var ch struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(data, &ch); err != nil {
		return "", err
	}
	return ch.ID, nil
}

// SendMessage sends a message to a channel.
func (c *Client) SendMessage(channelID, content string) error {
	payload := map[string]string{"content": content}
	_, err := c.do("POST", "/channels/"+channelID+"/messages", payload)
	return err
}
