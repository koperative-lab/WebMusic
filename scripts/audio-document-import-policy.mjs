/** DEC-053's one browser-adapter exception; never a capability-wide Edit edge. */
export function allowsAudioDocumentLoaderImport(name, importer, target, imported) {
  return name === '@webmusic/audio'
    && importer === 'edit/element/internal/audio-document-loader.ts'
    && target === 'play/api/load.ts'
    && imported.dynamic === false && imported.runtime === true
    && imported.symbols?.length === 1 && imported.symbols[0] === 'loadClipFromUrl';
}
