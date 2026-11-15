import {useSyncExternalStore} from 'react';
import {localMaintenance} from './local-maintenance';
import {HistoryExport} from './history-export/HistoryExport';
import {LOCAL_LIMIT} from '../shared/managed-storage';
export function LocalCapacity(){const s=useSyncExternalStore(localMaintenance.subscribe,localMaintenance.snapshot);return <><dl><div><dt>本機保存容量</dt><dd>{s.ready?(s.bytes/1048576).toFixed(1):'—'}／{LOCAL_LIMIT/1048576} MB</dd></div><div><dt>受保護資料量</dt><dd>{s.ready?(s.protectedBytes/1048576).toFixed(1)+' MB':'—'}</dd></div></dl>{s.error&&<p role="status" className="quality-note">{s.error}</p>}<HistoryExport/></>;}
