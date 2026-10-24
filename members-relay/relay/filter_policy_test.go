package main

import (
	"testing"

	"github.com/nbd-wtf/go-nostr"
)

func TestIsPublicNourishFilter(t *testing.T) {
	ok := nostr.Filter{
		Kinds:   []int{KindAppData},
		Authors: []string{NourishServicePubkey},
	}
	if !isPublicNourishFilter(ok) {
		t.Fatal("expected service-key kind 30078 filter to be public")
	}

	withLabel := nostr.Filter{
		Kinds:   []int{KindAppData},
		Authors: []string{NourishServicePubkey},
		Tags:    nostr.TagMap{"l": []string{"protein:30plus"}},
	}
	if !isPublicNourishFilter(withLabel) {
		t.Fatal("expected #l on service-key 30078 to remain public")
	}

	noAuthor := nostr.Filter{Kinds: []int{KindAppData}}
	if isPublicNourishFilter(noAuthor) {
		t.Fatal("bare kind 30078 must stay gated (member app-data)")
	}

	wrongAuthor := nostr.Filter{
		Kinds:   []int{KindAppData},
		Authors: []string{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
	}
	if isPublicNourishFilter(wrongAuthor) {
		t.Fatal("non-service 30078 must stay gated")
	}

	recipe := nostr.Filter{Kinds: []int{KindRecipe}}
	if isPublicNourishFilter(recipe) {
		t.Fatal("recipes use the KindRecipe public path, not nourish filter")
	}
}
