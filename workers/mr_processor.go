package main

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"strconv"
)

type GridKey struct {
	Lon int
	Lat int
}

type GridData struct {
	Sum   float64
	Count int
}

func main() {
	if len(os.Args) < 4 {
		fmt.Fprintf(os.Stderr, "Usage: %s <file_path> <grid_size> <val_col_name>\n", os.Args[0])
		os.Exit(1)
	}

	filePath := os.Args[1]
	gridSize, err := strconv.ParseFloat(os.Args[2], 64)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Invalid grid_size: %v\n", err)
		os.Exit(1)
	}
	valColName := os.Args[3]

	file, err := os.Open(filePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error opening file: %v\n", err)
		os.Exit(1)
	}
	defer file.Close()

	reader := csv.NewReader(file)
	header, err := reader.Read()
	if len(header) > 0 && len(header[0]) >= 3 && header[0][0] == 0xef && header[0][1] == 0xbb && header[0][2] == 0xbf {
		header[0] = header[0][3:]
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading header: %v\n", err)
		os.Exit(1)
	}

	lonIdx, latIdx, valIdx := -1, -1, -1
	for i, col := range header {
		if col == "Longitude" {
			lonIdx = i
		} else if col == "Latitude" {
			latIdx = i
		} else if col == valColName {
			valIdx = i
		}
	}

	if lonIdx == -1 || latIdx == -1 || valIdx == -1 {
		fmt.Fprintf(os.Stderr, "Missing required columns in CSV\n")
		os.Exit(1)
	}

	grid := make(map[GridKey]*GridData)

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		lon, err1 := strconv.ParseFloat(record[lonIdx], 64)
		lat, err2 := strconv.ParseFloat(record[latIdx], 64)
		val, err3 := strconv.ParseFloat(record[valIdx], 64)

		if err1 != nil || err2 != nil || err3 != nil {
			continue
		}

		gridLonIdx := int(math.Round(lon / gridSize))
		gridLatIdx := int(math.Round(lat / gridSize))
		key := GridKey{Lon: gridLonIdx, Lat: gridLatIdx}

		if data, exists := grid[key]; exists {
			data.Sum += val
			data.Count++
		} else {
			grid[key] = &GridData{Sum: val, Count: 1}
		}
	}

	var result [][]float64
	for key, data := range grid {
		mean := data.Sum / float64(data.Count)
		outLon := math.Round((float64(key.Lon)*gridSize)*100000) / 100000
		outLat := math.Round((float64(key.Lat)*gridSize)*100000) / 100000
		outVal := math.Round(mean*10) / 10
		result = append(result, []float64{outLon, outLat, outVal})
	}

	jsonBytes, err := json.Marshal(result)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error marshaling JSON: %v\n", err)
		os.Exit(1)
	}

	fmt.Println(string(jsonBytes))
}
