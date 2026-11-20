/* Open a Poly Nation SVG as an Illustrator document with top-level, named layers.
 * Run from Illustrator's File > Scripts > Other Script menu. The source SVG is kept on disk.
 */
(function () {
    var source = File.openDialog('Select an SVG exported from Poly Nation');
    if (!source) return;
    if (!/\.svg$/i.test(source.name)) {
        alert('Select a Poly Nation SVG drawing.');
        return;
    }

    function entry(item) {
        var id = /^PN_([0-9]+)_([A-Za-z0-9_]+)$/.exec(item.name || '');
        if (!id) return null;
        var label = id[2].replace(/([0-9])p([0-9])/g, '$1.$2').replace(/_/g, ' ');
        label = label.replace(/^(Pen [0-9]+) /, '$1 - ');
        return { order: Number(id[1]), label: label, item: item };
    }

    try {
        var drawing = app.open(source);
        var entries = [];
        var original = [];
        var i, j, layer, match;
        for (i = 0; i < drawing.layers.length; i++) {
            layer = drawing.layers[i];
            match = entry(layer);
            if (match) {
                entries.push(match);
                continue;
            }
            original.push(layer);
            for (j = 0; j < layer.pageItems.length; j++) {
                var item = layer.pageItems[j];
                if (item.parent.typename !== 'Layer') continue;
                match = entry(item);
                if (match) entries.push(match);
            }
        }

        // The export numbers the SVG groups from back to front. Verify the complete sequence
        // before moving anything, so missing or duplicate names cannot scramble a sheet.
        entries.sort(function (a, b) { return a.order - b.order; });
        var complete = entries.length >= 3 && entries[0].label === 'Paper' &&
            entries[entries.length - 1].label === 'Title and scale';
        for (i = 0; complete && i < entries.length; i++) complete = entries[i].order === i + 1;
        if (!complete) {
            alert('Illustrator could not find every Poly Nation group. The SVG is open with its original grouping.');
            return;
        }

        for (i = 0; i < entries.length; i++) {
            var current = entries[i];
            if (current.item.typename === 'Layer') {
                layer = current.item;
            } else {
                layer = drawing.layers.add();
                // Move the complete group to preserve its clipping mask and appearance.
                current.item.move(layer, ElementPlacement.PLACEATEND);
            }
            layer.name = current.label;
            layer.zOrder(ZOrderMethod.BRINGTOFRONT);
        }
        for (i = 0; i < original.length; i++) {
            layer = original[i];
            if (!layer.pageItems.length && !layer.layers.length) layer.remove();
        }
        alert('Poly Nation layers are ready. Use File > Save As to save an Illustrator document.');
    } catch (error) {
        alert('The Poly Nation SVG could not be organized into layers.\n' + error.message);
    }
}());
