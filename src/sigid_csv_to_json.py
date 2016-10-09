#!/usr/bin/env python

import json

def main():
    out = []

    # The input file is generated using the Signal Identification Guide (sigidwiki.com)
    # stored as the "db.csv" file from the Artemis 2 offline database (markslab.tk/project-artemis).
    with open("db.csv", "r") as f:
        for line in f:
            data = line.split('*')
            if len(data) > 7:
                description, freqStart, freqStop, url = data[0], int(data[1]), int(data[2]), data[7]
                current = {"freqStart": freqStart, "freqStop": freqStop, "description": description, "url": url}

                if (freqStart != 0 or freqStop != 0):
                    out.append(current)
                else:
                    print("Skipping: " + str(current))

    # Sort in decreasing bandwidth order. This ensures that signals with smaller bandwidth
    # will be drawn on top of signals with larger bandwidth.
    out.sort(key=lambda x: x["freqStop"] - x["freqStart"], reverse=True)

    with open("frequencies.json", "w") as f:
        json.dump(out, f, sort_keys=True)

if __name__ == "__main__":
    main()
