import { ColumnInfo, TableBuilder } from 'knex';
import { EntityProperty } from '../decorators';

export abstract class SchemaHelper {

  getSchemaBeginning(): string {
    return '';
  }

  getSchemaEnd(): string {
    return '';
  }

  finalizeTable(table: TableBuilder): void {
    //
  }

  getTypeDefinition(prop: EntityProperty, types: Record<string, string> = {}, lengths: Record<string, number> = {}): string {
    const t = prop.type.toLowerCase();
    let type = types[t] || types.json || types.text || t;

    if (type.includes('(?)')) {
      const length = prop.length || lengths[t];
      type = length ? type.replace('?', length) : type.replace('(?)', '');
    }

    return type;
  }

  isSame(prop: EntityProperty, info: ColumnInfo, types: Record<string, string> = {}): boolean {
    const t = Object.values(types).find(t => t.replace(/\(.\)$/, '') === info.type);
    return t === prop.type && info.nullable === !!prop.nullable && info.defaultValue === prop.default;
  }

  supportsSchemaConstraints(): boolean {
    return true;
  }

  indexForeignKeys() {
    return true;
  }

  supportsColumnAlter(): boolean {
    return true;
  }

  getListTablesSQL(): string {
    throw new Error('Not supported by given driver');
  }

}
