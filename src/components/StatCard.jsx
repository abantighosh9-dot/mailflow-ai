export default function StatCard({label,value,change,icon:Icon,tone="purple"}) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}><Icon size={19}/></span></div><div className="stat-value">{value}</div><div className="stat-change">{change}</div></div>;
}
