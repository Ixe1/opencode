package client

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/pkg/generated"
)

// getBaseURL returns the base URL from environment
func getBaseURL() string {
	url := os.Getenv("OPENCODE_SERVER")
	if url == "" {
		url = "http://localhost:54321/"
	}
	if !strings.HasSuffix(url, "/") {
		url += "/"
	}
	return url
}

// PostCheckpointListJSONRequestBody for checkpoint list requests
type PostCheckpointListJSONRequestBody = generated.PostCheckpointListJSONRequestBody

// PostCheckpointRestoreJSONRequestBody for checkpoint restore requests  
type PostCheckpointRestoreJSONRequestBody = generated.PostCheckpointRestoreJSONRequestBody

// CheckpointInfo represents checkpoint data
type CheckpointInfo struct {
	ID              string      `json:"id"`
	SessionID       string      `json:"sessionID"`
	MessageID       string      `json:"messageID"`
	CommitHash      string      `json:"commitHash"`
	Branch          string      `json:"branch"`
	Message         string      `json:"message"`
	Files           []string    `json:"files"`
	ProjectPath     string      `json:"projectPath"`
	ShadowRepoPath  string      `json:"shadowRepoPath"`
	Time            struct {
		Created float64 `json:"created"`
	} `json:"time"`
}

// PostCheckpointListResponse response for checkpoint list
type PostCheckpointListResponse struct {
	JSON200    *[]CheckpointInfo
	StatusCode int
}

// PostCheckpointRestoreResponse response for checkpoint restore
type PostCheckpointRestoreResponse struct {
	JSON200    *struct {
		Success bool `json:"success"`
	}
	StatusCode int
}

// PostCheckpointListWithResponse lists checkpoints using the SDK client base URL
func PostCheckpointListWithResponse(client *opencode.Client, ctx context.Context, body PostCheckpointListJSONRequestBody) (*PostCheckpointListResponse, error) {
	// Get base URL from OPENCODE_SERVER env var
	baseURL := getBaseURL()
	
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", baseURL+"checkpoint_list", bytes.NewReader(jsonBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 200 {
		var checkpoints []CheckpointInfo
		if err := json.NewDecoder(resp.Body).Decode(&checkpoints); err != nil {
			return nil, err
		}
		return &PostCheckpointListResponse{JSON200: &checkpoints, StatusCode: resp.StatusCode}, nil
	}

	return &PostCheckpointListResponse{StatusCode: resp.StatusCode}, nil
}

// PostCheckpointRestoreWithResponse restores a checkpoint using the SDK client base URL
func PostCheckpointRestoreWithResponse(client *opencode.Client, ctx context.Context, body PostCheckpointRestoreJSONRequestBody) (*PostCheckpointRestoreResponse, error) {
	// Get base URL from OPENCODE_SERVER env var
	baseURL := getBaseURL()
	
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", baseURL+"checkpoint_restore", bytes.NewReader(jsonBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 200 {
		var success struct {
			Success bool `json:"success"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&success); err != nil {
			return nil, err
		}
		return &PostCheckpointRestoreResponse{JSON200: &success, StatusCode: resp.StatusCode}, nil
	}

	return &PostCheckpointRestoreResponse{StatusCode: resp.StatusCode}, nil
}

// Extension methods for opencode.Client
type ClientExtensions struct{}

var Extensions = ClientExtensions{}

// PostCheckpointListWithResponse on the client
func (ClientExtensions) PostCheckpointListWithResponse(client *opencode.Client, ctx context.Context, body PostCheckpointListJSONRequestBody) (*PostCheckpointListResponse, error) {
	return PostCheckpointListWithResponse(client, ctx, body)
}

// PostCheckpointRestoreWithResponse on the client 
func (ClientExtensions) PostCheckpointRestoreWithResponse(client *opencode.Client, ctx context.Context, body PostCheckpointRestoreJSONRequestBody) (*PostCheckpointRestoreResponse, error) {
	return PostCheckpointRestoreWithResponse(client, ctx, body)
}