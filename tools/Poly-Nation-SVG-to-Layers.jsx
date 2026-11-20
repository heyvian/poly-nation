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

    function stageDrawing(svg) {
        var entries = [];
        // Read the numbered groups from the SVG itself. Some Illustrator versions discard their
        // names on import. A temporary text marker inside each group keeps its artwork identifiable.
        var marked = svg.replace(/<g\b[^>]*?\sid=(["'])PN_(\d+)_([A-Za-z0-9_]+)\1[^>]*>/g,
            function (tag, quote, number, name) {
                var label = name.replace(/([0-9])p([0-9])/g, '$1.$2').replace(/_/g, ' ');
                label = label.replace(/^(Pen [0-9]+) /, '$1 - ');
                var marker = 'PN_LAYER_MARKER_' + number + '_END';
                entries.push({ order: Number(number), label: label, marker: marker });
                return tag + '<text x="3" y="6" font-size="3" font-family="Arial" fill="#000000">' +
                    marker + '</text>';
            });
        if (entries.length < 3 || entries[0].label !== 'Paper' ||
                entries[entries.length - 1].label !== 'Title and scale') {
            throw new Error('This SVG has no Poly Nation layer list. Choose a drawing from Export SVG.');
        }
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].order !== i + 1) throw new Error('The SVG layer list is incomplete.');
        }
        return { svg: marked, entries: entries };
    }

    function findArtwork(drawing, entries) {
        var markers = {};
        var i, j;
        for (i = 0; i < entries.length; i++) markers[entries[i].marker] = entries[i];
        for (i = 0; i < drawing.textFrames.length; i++) {
            var text = drawing.textFrames[i];
            var entry = markers[text.contents.replace(/^\s+|\s+$/g, '')];
            if (!entry) continue;
            var owner = text.parent;
            // An importer may wrap the text in an extra group to apply font attributes.
            while (owner.typename === 'GroupItem' && owner.pageItems.length === 1) owner = owner.parent;
            if (owner.typename !== 'GroupItem' && owner.typename !== 'Layer') continue;
            if (entry.item) throw new Error('Illustrator duplicated a layer marker.');
            entry.item = owner;
            entry.text = text;
        }
        for (i = 0; i < entries.length; i++) {
            if (!entries[i].item) throw new Error('Illustrator could not identify the ' + entries[i].label + ' artwork.');
            for (j = 0; j < i; j++) {
                if (entries[i].item === entries[j].item) {
                    throw new Error('Illustrator merged two drawing groups during import.');
                }
            }
        }
    }

    var tempFolder, tempFile, drawing;
    try {
        source.encoding = 'UTF-8';
        if (!source.open('r')) throw new Error('The selected SVG could not be read.');
        var svg = source.read();
        source.close();
        var staged = stageDrawing(svg);

        var stamp = new Date().getTime() + '-' + Math.floor(Math.random() * 1000000);
        tempFolder = new Folder(Folder.temp.fsName + '/Poly-Nation-' + stamp);
        if (!tempFolder.create()) throw new Error('A temporary folder could not be created.');
        tempFile = new File(tempFolder.fsName + '/' + source.name.replace(/\.svg$/i, '-layers.svg'));
        tempFile.encoding = 'UTF-8';
        if (!tempFile.open('w')) throw new Error('The temporary drawing could not be written.');
        var written = tempFile.write(staged.svg);
        tempFile.close();
        if (!written) throw new Error('The temporary drawing could not be written.');
        drawing = app.open(tempFile);
        findArtwork(drawing, staged.entries);

        var original = [], i, layer;
        for (i = 0; i < drawing.layers.length; i++) original.push(drawing.layers[i]);
        // Groups are listed in paint order. Move the whole artwork to retain crop masks and
        // stroke widths, then remove the temporary markers before the document is saved.
        for (i = 0; i < staged.entries.length; i++) {
            var entry = staged.entries[i];
            entry.text.remove();
            if (entry.item.typename === 'Layer') {
                layer = entry.item;
            } else {
                layer = drawing.layers.add();
                entry.item.move(layer, ElementPlacement.PLACEATEND);
            }
            layer.name = entry.label;
            layer.zOrder(ZOrderMethod.BRINGTOFRONT);
        }
        for (i = 0; i < original.length; i++) {
            layer = original[i];
            if (!layer.pageItems.length && !layer.layers.length) layer.remove();
        }
        alert('Poly Nation layers are ready. Use File > Save As to save an Illustrator document.');
    } catch (error) {
        if (drawing) {
            // Failed staging leaves the original grouped SVG available and discards temporary ink.
            drawing.close(SaveOptions.DONOTSAVECHANGES);
            app.open(source);
        }
        alert('The Poly Nation SVG could not be organized into layers.\n' + error.message);
    } finally {
        if (tempFile && tempFile.exists) tempFile.remove();
        if (tempFolder && tempFolder.exists) tempFolder.remove();
    }
}());
