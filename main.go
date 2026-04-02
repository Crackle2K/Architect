package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"architect/discord"
)

func loadDotEnv() {
	data, err := os.ReadFile(".env")
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if os.Getenv(k) == "" {
			os.Setenv(k, v)
		}
	}
}

func main() {
	loadDotEnv()
	token := os.Getenv("DISCORD_TOKEN")
	if token == "" {
		fmt.Print("Enter your Discord token: ")
		reader := bufio.NewReader(os.Stdin)
		t, _ := reader.ReadString('\n')
		token = strings.TrimSpace(t)
	}

	client := discord.NewClient(token)

	user, err := client.GetCurrentUser()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: invalid token or network issue: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Logged in as %s#%s\n", user.Username, user.Discriminator)
	fmt.Println(`Commands:
  send <username> <message>   Send a DM to a friend
  friends                     List your friends
  help                        Show this help
  exit                        Quit`)
	fmt.Println()

	scanner := bufio.NewScanner(os.Stdin)
	for {
		fmt.Print("> ")
		if !scanner.Scan() {
			break
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		parts := strings.SplitN(line, " ", 3)
		cmd := strings.ToLower(parts[0])

		switch cmd {
		case "exit", "quit":
			fmt.Println("Bye!")
			return

		case "help":
			fmt.Println(`  send <username> <message>   Send a DM to a friend
  friends                     List your friends
  help                        Show this help
  exit                        Quit`)

		case "friends":
			friends, err := client.GetFriends()
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error: %v\n", err)
				continue
			}
			if len(friends) == 0 {
				fmt.Println("No friends found.")
				continue
			}
			fmt.Printf("%-20s  %s\n", "Username", "Display Name")
			fmt.Println(strings.Repeat("-", 40))
			for _, f := range friends {
				display := f.User.GlobalName
				if display == "" {
					display = f.User.Username
				}
				tag := f.User.Username
				if f.User.Discriminator != "" && f.User.Discriminator != "0" {
					tag = f.User.Username + "#" + f.User.Discriminator
				}
				fmt.Printf("%-20s  %s\n", tag, display)
			}

		case "send":
			if len(parts) < 3 {
				fmt.Println("Usage: send <username> <message>")
				continue
			}
			targetName := parts[1]
			message := parts[2]

			friends, err := client.GetFriends()
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error fetching friends: %v\n", err)
				continue
			}

			var targetID string
			for _, f := range friends {
				uname := strings.ToLower(f.User.Username)
				query := strings.ToLower(targetName)
				// match by username or username#discriminator
				full := uname
				if f.User.Discriminator != "" && f.User.Discriminator != "0" {
					full = uname + "#" + f.User.Discriminator
				}
				if uname == query || full == query {
					targetID = f.User.ID
					break
				}
			}

			if targetID == "" {
				fmt.Printf("No friend named %q found. Use 'friends' to list them.\n", targetName)
				continue
			}

			channelID, err := client.OpenDM(targetID)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error opening DM: %v\n", err)
				continue
			}

			if err := client.SendMessage(channelID, message); err != nil {
				fmt.Fprintf(os.Stderr, "Error sending message: %v\n", err)
				continue
			}
			fmt.Printf("Sent to %s: %s\n", targetName, message)

		default:
			// try to be helpful — maybe they forgot the command name
			b, _ := json.Marshal(parts)
			fmt.Printf("Unknown command: %s (input: %s)\nType 'help' for available commands.\n", cmd, b)
		}
	}
}
