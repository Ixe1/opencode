package client

import (
	"context"

	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/pkg/generated"
)

// ExtendedClient wraps the SDK client and adds generated client functionality
type ExtendedClient struct {
	*opencode.Client
	generated *generated.ClientWithResponses
}

// NewExtendedClient creates a new extended client
func NewExtendedClient(sdkClient *opencode.Client, baseURL string) (*ExtendedClient, error) {
	genClient, err := generated.NewClientWithResponses(baseURL)
	if err != nil {
		return nil, err
	}
	return &ExtendedClient{
		Client:    sdkClient,
		generated: genClient,
	}, nil
}

// PostCheckpointListWithResponse proxies to the generated client
func (c *ExtendedClient) PostCheckpointListWithResponse(ctx context.Context, body generated.PostCheckpointListJSONRequestBody, reqEditors ...generated.RequestEditorFn) (*generated.PostCheckpointListResponse, error) {
	return c.generated.PostCheckpointListWithResponse(ctx, body, reqEditors...)
}

// PostCheckpointRestoreWithResponse proxies to the generated client  
func (c *ExtendedClient) PostCheckpointRestoreWithResponse(ctx context.Context, body generated.PostCheckpointRestoreJSONRequestBody, reqEditors ...generated.RequestEditorFn) (*generated.PostCheckpointRestoreResponse, error) {
	return c.generated.PostCheckpointRestoreWithResponse(ctx, body, reqEditors...)
}