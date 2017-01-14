// Creates a waterfall object.
// id: string containing identifier of the div element to build the waterfall in.
// dataURL: string containing URL of the CSV data.
// annotationURL: string containing URL of the JSON data.
// isAnimatable: whether to enable animation during drawing.
// isSelectable: whether to enable user selection of different color interpolators.
// isZoomable: whether to enable user pan/zoom of the waterfall.
function Waterfall(id, dataURL, annotationURL, isAnimatable, isSelectable, isZoomable) {
    // Assume a 50px margin around the waterfall display
    this.margin = 50;

    // Store the parsed CSV data and URL
    this.data = null;
    this.dataURL = dataURL;

    // Stored the parsed JSON data and URL
    this.annotations = null;
    this.annotationURL = annotationURL;
    this.tooltip = null;

    // Build the scaling functions from data to pixel coordinates
    this.x = null;
    this.y = null;
    this.z = d3.scaleSequential(d3.interpolateViridis);

    this.animation = null;
    // Store the request identifier for the animation callback
    this.isAnimatable = isAnimatable;

    this.isZoomable = isZoomable;
    // Build the elements used for zooming
    this.zoom = d3.zoom().on("zoom", onZoom);
    // Stores the ImageBitmap of the canvas
    this.image = null;

    // Parent container for the canvas, svg, and interpolator drop-down
    this.div = d3.select(id);

    // Build canvas first, behind the svg
    this.canvas = this.div.append("canvas");

    // Build the svg and its elements
    this.svg = this.div.append("svg");
    this.svgGroup = this.svg.append("g");
    this.rectangle = this.svgGroup.append("rect");
    this.xAxis = null;
    this.yAxis = null;
    this.xAxisGroup = this.svgGroup.append("g");
    this.yAxisGroup = this.svgGroup.append("g");
    this.xAxisLabel = this.svgGroup.append("text");
    this.yAxisLabel = this.svgGroup.append("text");
    this.tooltipGroup = this.svgGroup.append("g");

    // Build the drop-down selection for the interpolator
    this.interpolators = [ "Viridis", "Inferno", "Magma", "Plasma", "Warm", "Cool", "Rainbow", "CubehelixDefault" ];
    this.interpolateSelect = (isSelectable === true) ? this.div.append("select")
        .on("change", onInterpolateChange).selectAll("option").data(this.interpolators)
        .enter()
        .append("option")
        .attr("value", function(d) { return d; })
        .text(function(d) { return d; }) : null;
}

// Callback for when the selected color interpolator is changed.
function onInterpolateChange() {
    // Cancel any existing callbacks to drawStep
    if (w.animation && window.cancelAnimationFrame) window.cancelAnimationFrame(w.animation);

    // Change the interpolator and redraw
    w.z.interpolator(d3["interpolate" + w.interpolators[this.selectedIndex]]);
    var context = w.canvas.node().getContext("2d");
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    renderDisplay(w);
}

// Callback to implement pan/zoom.
// Zooming is implemented using a stored ImageBitmap of the canvas to avoid redrawing the entire waterfall.
// TODO: Render canvas using higher resolution for better zooming.
function onZoom() {
    // Prevent zooming if no image available or not zoomable
    if (!w.image || !w.isZoomable) return;

    // Build the new scaling functions, with clamping disabled, and rescale the axes
    w.xAxisGroup.call(w.xAxis.scale(d3.event.transform.rescaleX(w.x)));
    w.yAxisGroup.call(w.yAxis.scale(d3.event.transform.rescaleY(w.y)));

    // Rescale the annotations
    if (w.annotations) {
        w.tooltipGroup.attr("transform", "translate(" + d3.event.transform.x + "," + d3.event.transform.y + ") scale(" + d3.event.transform.k + ")");
    }

    // Set the transformation matrix and redraw
    var context = w.canvas.node().getContext("2d");
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    context.save();
    context.translate(d3.event.transform.x, d3.event.transform.y);
    context.scale(d3.event.transform.k, d3.event.transform.k);
    context.drawImage(w.image, 0, 0, context.canvas.width, context.canvas.height);
    context.restore();
}

// Event listener to keep tooltip visible when gaining mouse focus
function onTooltipMouseover(d, i) {
    w.signal.transition().duration(0);
    w.tooltip.transition().duration(0);
    w.signal.style("opacity", 0.5);
}

// Event listener to hide tooltip when losing mouse focus
function onTooltipMouseout(d, i) {
    onSignalMouseout(d, i);
 }

// Event listener to show tooltip when signal gaining mouse focus
// Highlight the signal and set the tooltip.
function onSignalMouseover(d, i) {
    w.signal = d3.select(this);

    w.signal.transition(d3.transition().duration(100))
                   .style("opacity", 0.5);
    w.tooltip.style("left", d3.event.offsetX + 5 + "px")
             .style("top", d3.event.offsetY + 5 + "px");
    w.tooltip.transition(d3.transition().duration(100))
             .style("visibility", "visible");
    w.tooltip.html("<a href=\"" + d.url + "\" target=\"_blank\"><strong>" + d.description + "</strong></a><br><strong>Frequency:</strong> " + formatFrequency(d.freqStart) + " - " + formatFrequency(d.freqStop));
}

// Event listener to hide tooltip when signal losing mouse focus
function onSignalMouseout(d, i) {
    w.signal.transition(d3.transition().delay(100).duration(100))
                   .style("opacity", 0);
    w.tooltip.transition(d3.transition().delay(100).duration(100))
             .style("visibility", "hidden");
}

// Downloads and parses the data and annotation files
// cb: Function to call when completed. Generally should be set to initDisplay.
function getData(w, cb) {
    var data = d3.request(w.dataURL).mimeType("text/plain"),
        annotations = (w.annotationURL) ? d3.request(w.annotationURL).mimeType("application/json") : null;
    d3.queue()
        .defer(handleRequest, data, parseCSVData)
        .defer(handleRequest, annotations, parseJSONData)
        .awaitAll(function(error) {
            if (error) throw error;
            if (cb) cb(w);
        });
}

// Wrapper that calls the d3-queue callback and the user handler
function handleRequest(request, handler, cb) {
    if (request) {
        request.get(function(error, r) {
            if (error) cb(r.status, error);
            else cb(null, handler ? handler(r.responseText) : null);
        });
    } else {
        cb(null, null);
    }
}

// Parses the raw CSV data from rtl_power
function parseCSVData(response) {
    var parser = d3.timeParse("%Y-%m-%d %H:%M:%S");

    var freqStep = 0,
        freqRange = [Number.MAX_VALUE, Number.MIN_VALUE],
        timeRange = [Number.MAX_VALUE, Number.MIN_VALUE],
        dbRange = [Number.MAX_VALUE, Number.MIN_VALUE];

    function parseRow(d) {
        var dateTime = parser(d[0] + d[1]), // date + time
            freqLow = +d[2], // Hz low
            freqHigh = +d[3]; // Hz high
        freqStep = +d[4]; // Hz step

        results = [];
        for (i = 6; i < d.length; i++) {
            var dB = +d[i]; // dB

            // Skip NaN results
            if (isNaN(dB)) continue;

            dbRange = [Math.min(dbRange[0], dB), Math.max(dbRange[1], dB)];

            results.push({
                dateTime: dateTime,
                freq: freqLow + (i - 6) * freqStep,
                dB: dB,
            });
        }

        // Compute the fixed frequency step, and frequency/time/dB range
        freqRange = [Math.min(freqRange[0], freqLow), Math.max(freqRange[1], freqHigh)];
        timeRange = [Math.min(timeRange[0], dateTime), Math.max(timeRange[1], dateTime)];

        return results;
    }

    var array = d3.csvParseRows(response, parseRow);
    // Convert the raw values from an 1 * (N x M) to N * M array,
    // where N is the number of sweeps across the frequency range,
    // and M is the number of readings in each sweep.
    var values = [];
    var i = -1;
    array.forEach(function(d) {
        for (j = 0; j < d.length; j++) {
            if (d[j].freq != array[0][0].freq) {
                values[i].values.push({
                    freq: d[j].freq,
                    dB: d[j].dB,
                });
            } else {
                values[++i] = {
                    dateTime: d[j].dateTime,
                    values: [],
                };
            }
        }
    });

    // Adjust the time range by the estimated width/duration of the last step
    timeRange[1] += +values[values.length - 1].dateTime - +values[values.length - 2].dateTime;

    // Create the data object with metadata and values array
    w.data = { freqStep: freqStep, freqRange: freqRange, timeRange: timeRange, dbRange: dbRange, values: values };
}

// Parses the JSON known signals from sigid_csv_to_json.py
function parseJSONData(response) {
    w.annotations = JSON.parse(response);
}

// Formatter for frequency that uses SI and appends units
function formatFrequency(n) {
    return d3.format(".3s")(n) + "Hz";
}

// Initializes the waterfall display and its elements
function initDisplay(w) {
    // Compute the element sizes
    var width = w.div.node().clientWidth - 5,
        height = window.innerHeight - 15,
        elementWidth = width - 2 * w.margin,
        elementHeight = height - 2 * w.margin;

    // Set the svg size and add margin for labels
    w.svg.attr("width", width)
         .attr("height", height)
         .style("position", "absolute");
    w.svgGroup.attr("transform", "translate(" + w.margin + "," + w.margin + ")");

    // Create the scaling functions from the actual values to the size of the drawing surface on the canvas.
    // Apply rounded interpolation to eliminate graphical artifacts from numerical imprecision.
    w.x = d3.scaleLinear().range([0, elementWidth]).interpolate(d3.interpolateRound);
    w.y = d3.scaleTime().range([0, elementHeight]).interpolate(d3.interpolateRound);

    // Set the domain for each axis using the data range (min, max)
    w.x.domain(w.data.freqRange);
    w.y.domain(w.data.timeRange);
    w.z.domain(w.data.dbRange);

    // Set the canvas size to the element size, and draw an invisible svg rectangle on top
    w.canvas.attr("width", elementWidth)
            .attr("height", elementHeight)
            .style("padding", w.margin + "px")
            .style("position", "absolute");
    w.rectangle.attr("width", elementWidth)
               .attr("height", elementHeight)
               .style("fill", "#fff")
               .style("opacity", 0)
               .call(w.zoom);

    // Set the ticks on the axes, with a custom formatter for units
    w.xAxis = d3.axisTop(w.x).ticks(16).tickFormat(formatFrequency);
    w.xAxisGroup.attr("class", "axis x-axis")
                .call(w.xAxis);
    w.yAxis = d3.axisLeft(w.y);
    w.yAxisGroup.attr("class", "axis y-axis")
                .call(w.yAxis);

    // Set the text labels on the axes
    w.xAxisLabel.attr("class", "axis x-axis")
                .attr("text-anchor", "middle")
                .attr("transform", "translate(" + elementWidth / 2 + "," + -w.margin / 2 + ")")
                .text("Frequency");
    w.yAxisLabel.attr("class", "axis y-axis")
                .attr("text-anchor", "middle")
                .attr("transform", "translate(" + -w.margin / 2 + "," + (w.margin / 4) + ")")
                .text("Time");

    // Create the tooltips, with clamping enabled
    if (w.annotations) {
        w.x.clamp(true);

        w.tooltip = w.div.append("div")
                         .attr("class", "tooltip")
                         .style("opacity", 0.75)
                         .style("position", "absolute")
                         .style("visibility", "hidden")
                         .on("mouseover", onTooltipMouseover)
                         .on("mouseout", onTooltipMouseout);

        // Display the annotations by highlighting the signal and showing the tooltip
        w.tooltipGroup.selectAll("rect")
                      .data(w.annotations)
                      .enter().append("rect")
                              .attr("class", "signal")
                              .attr("x", function(d) { return w.x(d.freqStart); })
                              .attr("y", w.y(+w.y.domain()[0]))
                              .attr("width", function(d) { return w.x(d.freqStop) - w.x(d.freqStart); })
                              .attr("height",  w.y(+w.y.domain()[1]) - w.y(+w.y.domain()[0]))
                              .style("fill", "#fff")
                              .style("opacity", 0)
                              .on("mouseover", onSignalMouseover)
                              .on("mouseout", onSignalMouseout)
                              .call(w.zoom);

        w.x.clamp(false);
    }

    // Draw the waterfall
    renderDisplay(w);
}

// If animation callbacks are available, draw a row of rectangles in each callback.
// Otherwise, draw everything at once, but the canvas will not be updated until done.
function renderDisplay(w) {
    var context = w.canvas.node().getContext("2d");

    // Invalidate the image data cache
    if (w.isZoomable) w.image = null;

    if (w.isAnimatable && window.requestAnimationFrame) {
        var i = 0;
        var drawStep = function(timestamp) {
            drawRow.call({ context: context, x: w.x, y: w.y, z: w.z }, w.data.values[i], i, w.data.values);

            // Cache the image data if done
            if (++i < w.data.values.length) {
                w.animation = window.requestAnimationFrame(drawStep);
            } else if (w.isZoomable && createImageBitmap) {
                createImageBitmap(context.getImageData(0, 0, context.canvas.width, context.canvas.height)).then(function(resolve, reject) {
                    if (reject) throw reject;
                    w.image = resolve;
                });
            }
        };

        w.animation = window.requestAnimationFrame(drawStep);
    } else {
        w.data.values.forEach(drawRow, { context: context, x: w.x, y: w.y, z: w.z });
    }
}

// Draw one row/timestep of data.
// Computes the rectangle height using the next time step, or if not available, the previous time step.
// TODO: Memoize this function for better performance.
function drawRow(time, i, array) {
    for (j = 0; j < time.values.length; ++j) {
        var rowWidth = (i != array.length - 1 && j < array[i + 1].values.length) ? this.y(+array[i + 1].dateTime) - this.y(+time.dateTime): this.y(+time.dateTime) - this.y(+array[i - 1].dateTime);
        this.context.fillStyle = this.z(time.values[j].dB);
        this.context.fillRect(this.x(time.values[j].freq), this.y(time.dateTime), this.x(time.values[j].freq + w.data.freqStep) - this.x(time.values[j].freq), rowWidth);
    }
}
