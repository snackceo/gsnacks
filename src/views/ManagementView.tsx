import PricingIntelligence from './management/PricingIntelligence';
import { Receipt } from 'lucide-react';

const managementSections = {
    stores: /* existing stores section code */, // existing content should remain intact
    pricing: {
        id: 'pricing',
        label: 'Pricing Intel',
        icon: Receipt,
        render: () => <PricingIntelligence />,  
    },
    // other existing sections...
};

export default managementSections;