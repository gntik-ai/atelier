const cstring = (buffer, offset) => { const end = buffer.indexOf(0, offset); return [buffer.toString('utf8', offset, end), end + 1]; };
export class WalEventDecoder {
  constructor() { this._relations = new Map(); }
  decodeMessage(buffer, lsn) {
    const type = String.fromCharCode(buffer[0]);
    try {
      if (type === 'R') return this._decodeRelation(buffer);
      if (type === 'I') return this._decodeInsert(buffer, lsn);
      if (type === 'U') return this._decodeUpdate(buffer, lsn);
      if (type === 'D') return this._decodeDelete(buffer, lsn);
      return null;
    } catch { return null; }
  }
  _decodeRelation(buf) {
    let offset = 1;
    const relationId = buf.readUInt32BE(offset); offset += 4;
    const [namespace, o1] = cstring(buf, offset); offset = o1;
    const [relationName, o2] = cstring(buf, offset); offset = o2;
    offset += 1; const columnCount = buf.readUInt16BE(offset); offset += 2;
    const columns = [];
    for (let i = 0; i < columnCount; i += 1) {
      offset += 1; const [name, o3] = cstring(buf, offset); offset = o3;
      const typeId = buf.readUInt32BE(offset); offset += 4; offset += 4;
      columns.push({ name, typeId });
    }
    const relation = { relationId, namespace, relationName, columns };
    this._relations.set(relationId, relation);
    return relation;
  }
  _decodeInsert(buf, lsn) { const relation = this._relations.get(buf.readUInt32BE(1)); return { type: 'insert', relation, newRow: this._decodeRowData(buf, 6, relation).fields, lsn }; }
  _decodeUpdate(buf, lsn) { const relation = this._relations.get(buf.readUInt32BE(1)); return { type: 'update', relation, newRow: this._decodeRowData(buf, 6, relation).fields, oldRow: null, lsn }; }
  _decodeDelete(buf, lsn) { const relation = this._relations.get(buf.readUInt32BE(1)); return { type: 'delete', relation, oldRow: this._decodeRowData(buf, 6, relation).fields, lsn }; }
  _decodeRowData(buf, offset, relation) {
    const tupleType = String.fromCharCode(buf[offset]); offset += 1; if (tupleType !== 'N' && tupleType !== 'K' && tupleType !== 'O') return { fields: {} };
    const count = buf.readUInt16BE(offset); offset += 2; const fields = {};
    for (let i = 0; i < count; i += 1) {
      const kind = String.fromCharCode(buf[offset]); offset += 1;
      const column = relation?.columns?.[i]?.name ?? `col_${i}`;
      if (kind === 'n') { fields[column] = null; continue; }
      const len = buf.readUInt32BE(offset); offset += 4; fields[column] = buf.toString('utf8', offset, offset + len); offset += len;
    }
    return { fields, offset };
  }
}
