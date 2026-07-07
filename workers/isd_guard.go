package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sync"
)

// Point4326 holds a decimal-degree lat/lon (EPSG:4326).
type Point4326 struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

// Request is a single ISD validation request (one candidate vs many sites).
type Request struct {
	Candidate Point4326   `json:"candidate"`
	Sites     []Point4326 `json:"sites"`
	MinDist   float64     `json:"min_dist"`
}

// Response for a single candidate.
type Response struct {
	Valid bool    `json:"valid"`
	Lat   float64 `json:"lat"`
	Lon   float64 `json:"lon"`
}

// haversine returns the great-circle distance in metres.
func haversine(lat1, lon1, lat2, lon2 float64) float64 {
	dLat := (lat2 - lat1) * math.Pi / 180.0
	dLon := (lon2 - lon1) * math.Pi / 180.0
	lat1Rad := lat1 * math.Pi / 180.0
	lat2Rad := lat2 * math.Pi / 180.0

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return 6371000.0 * c
}

// validateOne checks a single candidate against all sites concurrently.
func validateOne(candidate Point4326, sites []Point4326, minDist float64) bool {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var wg sync.WaitGroup
	valid := true
	var mu sync.Mutex

	for _, site := range sites {
		wg.Add(1)
		go func(s Point4326) {
			defer wg.Done()
			select {
			case <-ctx.Done():
				return
			default:
			}
			d := haversine(candidate.Lat, candidate.Lon, s.Lat, s.Lon)
			if d < minDist {
				mu.Lock()
				valid = false
				mu.Unlock()
				cancel()
			}
		}(site)
	}
	wg.Wait()
	return valid
}

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)

	// Read one JSON object per line from stdin (persistent pipe mode)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" || line == "QUIT" {
			break
		}

		var req Request
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			fmt.Fprintf(os.Stderr, "decode error: %v\n", err)
			encoder.Encode(Response{Valid: false, Lat: 0, Lon: 0})
			continue
		}

		valid := validateOne(req.Candidate, req.Sites, req.MinDist)
		encoder.Encode(Response{
			Valid: valid,
			Lat:   req.Candidate.Lat,
			Lon:   req.Candidate.Lon,
		})
	}
}
