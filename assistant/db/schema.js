/**
 * CEO HQ database schema.
 * Column order here must match the header row of each Google Sheet
 * (see assistant/config/database.json for file IDs).
 */
const TABLES = {
  leads: {
    prefix: 'LEAD',
    columns: ['ID', 'Date', 'Entity', 'Name', 'Company', 'Phone', 'Email', 'Source', 'Status', 'Owner', 'NextAction', 'NextActionDate', 'EstValue', 'Notes'],
  },
  meetings: {
    prefix: 'MTG',
    columns: ['ID', 'Date', 'Time', 'Entity', 'Title', 'Participants', 'Location', 'Agenda', 'Decisions', 'ActionItems', 'FollowUpDate', 'Status', 'Notes'],
  },
  opportunities: {
    prefix: 'OPP',
    columns: ['ID', 'Date', 'Entity', 'Title', 'Type', 'Stage', 'EstValue', 'Probability', 'Contact', 'NextStep', 'Deadline', 'Owner', 'Notes'],
  },
  ideas: {
    prefix: 'IDEA',
    columns: ['ID', 'Date', 'Entity', 'Title', 'Category', 'Description', 'Impact', 'Effort', 'Status', 'Owner', 'Notes'],
  },
  campaigns: {
    prefix: 'CAMP',
    columns: ['ID', 'Entity', 'Name', 'Channel', 'Audience', 'Budget', 'StartDate', 'EndDate', 'Status', 'KPIs', 'Results', 'Owner', 'Notes'],
  },
  strategy: {
    prefix: 'STR',
    columns: ['ID', 'Entity', 'Goal', 'Quarter', 'KeyResults', 'Initiatives', 'Owner', 'Status', 'Progress', 'ReviewDate', 'Notes'],
  },
  audit: {
    prefix: 'AUD',
    columns: ['ID', 'Date', 'Entity', 'Area', 'Finding', 'Severity', 'Recommendation', 'Owner', 'DueDate', 'Status', 'Notes'],
  },
  bizdev: {
    prefix: 'BD',
    columns: ['ID', 'Date', 'Entity', 'Initiative', 'Type', 'Partner', 'Stage', 'PotentialValue', 'NextStep', 'Owner', 'Notes'],
  },
  tasks: {
    prefix: 'TASK',
    columns: ['ID', 'Date', 'Entity', 'Task', 'Priority', 'Owner', 'DueDate', 'Status', 'RelatedTo', 'Notes'],
  },
  decisions: {
    prefix: 'DEC',
    columns: ['ID', 'Date', 'Entity', 'Decision', 'Context', 'DecidedBy', 'Impact', 'ReviewDate', 'Status', 'Notes'],
  },
  contacts: {
    prefix: 'CON',
    columns: ['ID', 'Name', 'Entity', 'Role', 'Company', 'Phone', 'Email', 'Tags', 'Notes'],
  },
};

module.exports = { TABLES };
