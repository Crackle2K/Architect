package discord

type User struct {
	ID            string `json:"id"`
	Username      string `json:"username"`
	Discriminator string `json:"discriminator"`
	GlobalName    string `json:"global_name"`
}

// Relationship represents a Discord relationship (friend, blocked, etc.)
// Type 1 = friend, 2 = blocked, 3 = incoming request, 4 = outgoing request.
type Relationship struct {
	Type int  `json:"type"`
	User User `json:"user"`
}
